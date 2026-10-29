"""
Push alerts for followed trains, evaluated after every refresh.

Which follows: those with a push target (an Expo token on the device with
alerts enabled, or a Live Activity token for the follow) that run today:
one-off trips on their service date (or the day before, for trains past
midnight), commutes on their weekdays via `resolve_commute_trip`. Only trains
on the live map are evaluated; everything else is skipped quietly.

Rules, per follow and service date (state in `notification_state`):

- Delay: our GPS delay (not OTP's) above the follow's threshold alerts. It
  re-alerts only when the delay moved by at least DELAY_REALERT_STEP_MIN from
  the last notified value. After a delay alert, the delay dropping to the
  threshold or below sends one "back on time".
- Platform: the platform at the boarding station differing from the last
  notified one alerts. On first sight it is compared with the scheduled
  platform: for trip follows with a boarding stop, the platform of that stop;
  for commutes, the train's usual platform at the boarding station from the
  delay history when at least PLATFORM_MIN_CONFIDENCE of its recent
  passages used it. Otherwise the first platform seen is a silent baseline.
  Not sent once the train has left the boarding station.
- Train ahead: the train before ours over the last segment into the boarding
  station (it calls at our previous station and then at our boarding station,
  scheduled there within TRAIN_AHEAD_WINDOW_S before us) is at least
  TRAIN_AHEAD_MIN_DELAY_MIN late, and ours has not left the boarding station
  and is not itself reported late. In the delay history the next train was then
  late 57% of the time against 15% normally. At most once per follow per day.
- Quiet: nothing once the train has passed the alighting station (or its
  terminus), and at most one notification per follow per QUIET_INTERVAL;
  alerts due at the same time go out as one notification, and alerts held
  back are re-evaluated on the next run.

Delivery: Expo push to every Expo token of the device, except when the follow
has a Live Activity, which then carries the alert instead (iOS would show
both). Live Activities also get silent (priority 5) updates: at once when the
delay, the stop shown, its platform or departure change, otherwise at most every
LIVE_ACTIVITY_MIN_INTERVAL_S while the progress moves; each goes stale after
LIVE_ACTIVITY_STALE_S. `end` follows once the train has passed the alighting
station. LIVE_ACTIVITY_PUSH_ENABLED off drops the Live Activity tokens, and
alerts go out through Expo.

The new state is written in the same transaction that records the delivery
outcome on the tokens. If every delivery failed, the alert state is not
advanced, so the alert is retried on the next run.
"""

import json
import uuid
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime, timedelta
from typing import Any, Protocol

from redis.asyncio import Redis
from sqlalchemy import and_, delete, exists, or_, select, tuple_, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.cache import cached_model
from api.core.config import settings
from api.core.logging_config import get_logger
from api.core.redis import add_key
from api.models.devices import Device, Follow, NotificationState, PushToken
from api.schemas.insights import StationPlatforms
from api.services import insights
from api.services.commute import resolve_commute_trip
from api.services.devices import device_key
from api.services.history import MAX_OFF_ROUTE_M, passed_stop_index
from api.services.push_copy import (
    Alert,
    AlertKind,
    TrainContext,
    lang_for,
    render,
)
from api.services.push_senders import (
    ExpoMessage,
    ExpoSender,
    LiveActivityMessage,
    LiveActivitySender,
    Outcome,
    SendResult,
)
from api.util.stop import station_id, station_id_from_gtfs_id
from api.util.time import BUDAPEST_TZ, service_day_start

logger = get_logger(__name__)

DELAY_REALERT_STEP_MIN = 5
QUIET_INTERVAL = timedelta(minutes=5)
TRAIN_AHEAD_MIN_DELAY_MIN = 15
TRAIN_AHEAD_WINDOW_S = 60 * 60
# A commute's usual platform stands in for the schedule only if this share of
# its passages over the last PLATFORM_HISTORY_DAYS used it
PLATFORM_MIN_CONFIDENCE = 0.8
PLATFORM_HISTORY_DAYS = 28
PLATFORM_CACHE_TTL_S = 6 * 3600

# A Live Activity shows as stale if no update arrives for this long
LIVE_ACTIVITY_STALE_S = 10 * 60
# ... and stays on the lock screen this long after it ends
LIVE_ACTIVITY_DISMISS_S = 30 * 60
LIVE_ACTIVITY_CONTENT_TTL_S = 12 * 3600
# Progress and times alone are pushed at most this often
LIVE_ACTIVITY_MIN_INTERVAL_S = 60

# Only one evaluation runs at a time
LOCK_TTL_S = 5 * 60
# Expo receipts are ready after a few minutes and kept for a day
RECEIPT_DELAY_S = 15 * 60
RECEIPT_MAX_AGE_S = 24 * 3600

DELIVERED = (Outcome.OK, Outcome.SKIPPED)
DAY_S = 24 * 3600


def receipts_key() -> str:
    """
    Sorted set of pending Expo tickets, `<ticket id>|<push token id>`.
    Deliberately one global key rather than per device (`device_key`): it
    holds only ticket and token ids, and entries are dropped within a day.
    """
    return add_key("push:expo-receipts")


def live_activity_key(device_id: uuid.UUID, token_id: uuid.UUID) -> str:
    """Last content state sent to a Live Activity."""
    return device_key(device_id, f"liveactivity:{token_id}")


# --- Pure rules ---


@dataclass(slots=True)
class AlertState:
    trip_id: str | None = None
    last_delay_min: int | None = None
    last_platform: str | None = None
    last_notified_at: datetime | None = None
    train_ahead_notified_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class TrainAhead:
    label: str
    delay_min: int


@dataclass(frozen=True, slots=True)
class Observation:
    """A followed train as the live data shows it now."""

    trip_id: str
    service_date: date
    context: TrainContext
    # GPS delay in minutes; None when the position is unreliable
    delay_min: int | None
    # Platform at the boarding station now, and the scheduled one if known
    platform: str | None
    scheduled_platform: str | None
    # Passed the boarding / alighting station
    departed: bool
    finished: bool
    train_ahead: TrainAhead | None = None
    # The stop the Live Activity shows: the boarding station until the train
    # leaves it, then the next stop. Expected time there (Unix seconds) and
    # its platform
    next_stop: str | None = None
    next_stop_at: int | None = None
    next_platform: str | None = None
    # Expected arrival at the alighting station, Unix seconds
    eta: int | None = None
    # Share of the ride from boarding to alighting behind the train, 0 to 1
    progress: float = 0.0
    # The train on the live map, for opening it from the notification
    vehicle_id: str | None = None


class Prefs(Protocol):
    """The alert preferences of a follow (see api.models.devices.Follow)."""

    alerts_enabled: bool
    delay_threshold_min: int
    notify_platform_change: bool


@dataclass(frozen=True, slots=True)
class Decision:
    alerts: list[Alert]
    # Stored once the alerts are delivered
    state: AlertState
    # Stored when nothing is delivered (new trip, platform baseline)
    quiet_state: AlertState


def _same_platform(a: str, b: str) -> bool:
    return a.strip().casefold() == b.strip().casefold()


def decide(
    prefs: Prefs, obs: Observation, previous: AlertState | None, now: datetime
) -> Decision:
    """Which alerts are due for one follow; see the module docstring."""
    if previous is not None and previous.trip_id == obs.trip_id:
        base = previous
    else:
        base = AlertState(trip_id=obs.trip_id)
    quiet = replace(base)
    if obs.finished or not prefs.alerts_enabled:
        return Decision([], quiet, quiet)

    new = replace(base)
    alerts: list[Alert] = []
    threshold = prefs.delay_threshold_min
    last_delay = base.last_delay_min
    delay_alerted = last_delay is not None and last_delay > threshold
    delay = obs.delay_min
    if delay is not None:
        if delay > threshold and (
            last_delay is None
            or not delay_alerted
            or abs(delay - last_delay) >= DELAY_REALERT_STEP_MIN
        ):
            alerts.append(Alert(AlertKind.DELAY, delay_min=delay))
            new.last_delay_min = delay
        elif delay <= threshold and delay_alerted:
            alerts.append(Alert(AlertKind.ON_TIME))
            new.last_delay_min = delay

    if prefs.notify_platform_change and obs.platform and not obs.departed:
        reference = base.last_platform or obs.scheduled_platform
        if reference is not None and not _same_platform(obs.platform, reference):
            alerts.append(Alert(AlertKind.PLATFORM, platform=obs.platform))
            new.last_platform = obs.platform
        elif base.last_platform is None:
            quiet.last_platform = new.last_platform = obs.platform

    late = delay_alerted or (delay is not None and delay > threshold)
    if (
        obs.train_ahead is not None
        and base.train_ahead_notified_at is None
        and not obs.departed
        and not late
    ):
        alerts.append(Alert(AlertKind.TRAIN_AHEAD, delay_min=obs.train_ahead.delay_min))
        new.train_ahead_notified_at = now

    if not alerts or (
        base.last_notified_at is not None
        and now - base.last_notified_at < QUIET_INTERVAL
    ):
        return Decision([], quiet, quiet)
    new.last_notified_at = now
    return Decision(alerts, new, quiet)


# --- Reading the live data ---


def _find_station(
    stoptimes: list[dict[str, Any]], station: str | None, start: int = 0
) -> int | None:
    if station is None:
        return None
    for i in range(start, len(stoptimes)):
        if station_id(stoptimes[i].get("stop") or {}) == station:
            return i
    return None


def platform_of_stop(gtfs_id: str) -> str | None:
    """`1:005501024_14` -> `14`: the platform a platform-level stop stands for."""
    local = gtfs_id.split(":", 1)[-1]
    _, sep, platform = local.partition("_")
    return (platform or None) if sep else None


def train_label(trip: dict[str, Any]) -> str:
    """'S70' for numbered lines, else category and number, e.g. 'IC 559'."""
    route = ((trip.get("route") or {}).get("shortName") or "").strip()
    parts = (trip.get("tripShortName") or "").split()
    number = parts[0] if parts else ""
    if route and any(c.isdigit() for c in route):
        return route
    return f"{route} {number}".strip()


def _stop_time(st: dict[str, Any], departure: bool) -> int | None:
    first, second = (
        ("scheduledDeparture", "scheduledArrival")
        if departure
        else ("scheduledArrival", "scheduledDeparture")
    )
    value = st.get(first)
    return st.get(second) if value is None else value


def _service_date(trip: dict[str, Any]) -> date | None:
    try:
        return date.fromisoformat(trip.get("serviceDate") or "")
    except ValueError:
        return None


def _absolute_s(service_date: date, seconds: int) -> int:
    """Comparable time across service dates (DST ignored)."""
    return service_date.toordinal() * DAY_S + seconds


def _reliable(location: dict[str, Any]) -> bool:
    off_route = location.get("offRouteMeters")
    return off_route is not None and off_route <= MAX_OFF_ROUTE_M


def find_train_ahead(
    locations: Iterable[dict[str, Any]], location: dict[str, Any], board_idx: int
) -> TrainAhead | None:
    """
    The live train scheduled last before ours over the segment into the
    boarding station, if it is at least TRAIN_AHEAD_MIN_DELAY_MIN late.
    """
    trip = location.get("trip") or {}
    stoptimes = trip.get("stoptimes") or []
    service_date = _service_date(trip)
    if board_idx <= 0 or board_idx >= len(stoptimes) or service_date is None:
        return None
    board = station_id(stoptimes[board_idx].get("stop") or {})
    previous = station_id(stoptimes[board_idx - 1].get("stop") or {})
    ours_s = _stop_time(stoptimes[board_idx], departure=False)
    if board is None or previous is None or ours_s is None:
        return None
    ours = _absolute_s(service_date, ours_s)

    best: tuple[int, dict[str, Any]] | None = None
    for other in locations:
        other_trip = other.get("trip") or {}
        if other_trip.get("gtfsId") == trip.get("gtfsId"):
            continue
        other_stoptimes = other_trip.get("stoptimes") or []
        p = _find_station(other_stoptimes, previous)
        b = None if p is None else _find_station(other_stoptimes, board, p + 1)
        other_date = _service_date(other_trip)
        if b is None or other_date is None:
            continue
        at = _stop_time(other_stoptimes[b], departure=False)
        if at is None:
            continue
        at = _absolute_s(other_date, at)
        if ours - TRAIN_AHEAD_WINDOW_S <= at < ours and (best is None or at > best[0]):
            best = (at, other)

    if best is None:
        return None
    ahead = best[1]
    delay = ahead.get("delay")
    if not _reliable(ahead) or delay is None or delay < TRAIN_AHEAD_MIN_DELAY_MIN:
        return None
    return TrainAhead(train_label(ahead.get("trip") or {}), int(delay))


def _local_hhmm(service_date: date, seconds: int | None) -> str:
    if seconds is None:
        return ""
    at = service_day_start(service_date) + timedelta(seconds=seconds)
    return at.astimezone(BUDAPEST_TZ).strftime("%H:%M")


@dataclass(slots=True)
class FollowInfo:
    """
    A follow read once per run. Plain data, so a rollback after one follow's
    failure cannot expire what the others need.
    """

    id: uuid.UUID
    device_id: uuid.UUID
    kind: str
    trip_short_name: str
    trip_id: str | None
    service_date: date | None
    from_stop_id: str | None
    to_stop_id: str | None
    weekdays: int | None
    from_station_id: str | None
    to_station_id: str | None
    alerts_enabled: bool
    delay_threshold_min: int
    notify_platform_change: bool
    locale: str | None

    @classmethod
    def of(cls, f: Follow, locale: str | None) -> "FollowInfo":
        return cls(
            id=f.id,
            device_id=f.device_id,
            kind=f.kind,
            trip_short_name=f.trip_short_name,
            trip_id=f.trip_id,
            service_date=f.service_date,
            from_stop_id=f.from_stop_id,
            to_stop_id=f.to_stop_id,
            weekdays=f.weekdays,
            from_station_id=f.from_station_id,
            to_station_id=f.to_station_id,
            alerts_enabled=f.alerts_enabled,
            delay_threshold_min=f.delay_threshold_min,
            notify_platform_change=f.notify_platform_change,
            locale=locale,
        )


@dataclass(frozen=True, slots=True)
class TokenInfo:
    id: uuid.UUID
    device_id: uuid.UUID
    type: str
    token: str
    follow_id: uuid.UUID | None


@dataclass(frozen=True, slots=True)
class Tracked:
    """A followed train found on the live map."""

    location: dict[str, Any]
    board_idx: int
    alight_idx: int
    scheduled_platform: str | None = None


def observe(
    tracked: Tracked, locations: Sequence[dict[str, Any]], now: datetime
) -> Observation | None:
    loc = tracked.location
    trip = loc.get("trip") or {}
    stoptimes = trip.get("stoptimes") or []
    service_date = _service_date(trip)
    if not stoptimes or service_date is None or not trip.get("gtfsId"):
        return None
    board_st = stoptimes[tracked.board_idx]
    board_stop = board_st.get("stop") or {}

    reliable = _reliable(loc)
    delay = loc.get("delay") if reliable else None
    passed = passed_stop_index(loc) if reliable else None
    departed = passed is not None and passed >= tracked.board_idx
    finished = passed is not None and passed >= tracked.alight_idx

    late_s = max(delay or 0, 0) * 60

    def expected(seconds: int | None) -> int | None:
        if seconds is None:
            return None
        at = service_day_start(service_date) + timedelta(seconds=seconds + late_s)
        return int(at.timestamp())

    next_idx = (loc.get("vehicleProgress") or {}).get("nextStopIndex")
    if not departed:
        focus = tracked.board_idx
    elif isinstance(next_idx, int) and tracked.board_idx < next_idx < len(stoptimes):
        focus = min(next_idx, tracked.alight_idx)
    else:
        focus = tracked.alight_idx
    focus_st = stoptimes[focus]
    focus_stop = focus_st.get("stop") or {}
    departure = expected(_stop_time(board_st, departure=True))
    eta = expected(_stop_time(stoptimes[tracked.alight_idx], departure=False))
    progress = 0.0
    if finished:
        progress = 1.0
    elif departed and departure is not None and eta is not None and eta > departure:
        ratio = (now.timestamp() - departure) / (eta - departure)
        progress = round(min(max(ratio, 0.0), 1.0), 2)

    return Observation(
        trip_id=trip["gtfsId"],
        service_date=service_date,
        context=TrainContext(
            label=train_label(trip),
            station=board_stop.get("name") or "",
            time=_local_hhmm(service_date, _stop_time(board_st, departure=True)),
        ),
        delay_min=None if delay is None else int(delay),
        platform=board_stop.get("platformCode"),
        scheduled_platform=tracked.scheduled_platform,
        departed=departed,
        finished=finished,
        train_ahead=None
        if departed
        else find_train_ahead(locations, loc, tracked.board_idx),
        next_stop=focus_stop.get("name"),
        next_stop_at=expected(_stop_time(focus_st, departure=not departed)),
        next_platform=focus_stop.get("platformCode"),
        eta=eta,
        progress=progress,
        vehicle_id=loc.get("vehicleId"),
    )


def track_trip(
    follow: FollowInfo, live: dict[tuple[str, str], dict[str, Any]]
) -> Tracked | None:
    if follow.trip_id is None or follow.service_date is None:
        return None
    loc = live.get((follow.trip_id, follow.service_date.isoformat()))
    if loc is None:
        return None
    stoptimes = (loc.get("trip") or {}).get("stoptimes") or []
    if not stoptimes:
        return None
    board, scheduled_platform = 0, None
    if follow.from_stop_id:
        found = _find_station(stoptimes, station_id_from_gtfs_id(follow.from_stop_id))
        board = found or 0
        scheduled_platform = platform_of_stop(follow.from_stop_id)
    alight = None
    if follow.to_stop_id:
        alight = _find_station(
            stoptimes, station_id_from_gtfs_id(follow.to_stop_id), board + 1
        )
    return Tracked(
        loc,
        board,
        len(stoptimes) - 1 if alight is None else alight,
        scheduled_platform,
    )


async def track_commute(
    redis: Redis,
    follow: FollowInfo,
    locations: list[dict[str, Any]],
    live: dict[tuple[str, str], dict[str, Any]],
    today: date,
) -> Tracked | None:
    # Yesterday's train may still be running past midnight
    for day in (today, today - timedelta(days=1)):
        resolved = await resolve_commute_trip(redis, follow, day, locations)
        if resolved is not None:
            break
    else:
        return None
    loc = live.get((resolved.tripId, resolved.serviceDate.isoformat()))
    if loc is None:
        return None
    stoptimes = (loc.get("trip") or {}).get("stoptimes") or []
    board = _find_station(stoptimes, follow.from_station_id)
    if board is None:
        return None
    alight = _find_station(stoptimes, follow.to_station_id, board + 1)
    return Tracked(loc, board, len(stoptimes) - 1 if alight is None else alight)


async def usual_platform(
    session: AsyncSession, redis: Redis, station: str, train_number: str
) -> str | None:
    """
    The platform a train usually uses at a station (the platform prediction
    of the history API), if confident enough; else None.
    """
    platforms = await cached_model(
        redis,
        f"alerts:usual-platform:{station}:{train_number}",
        StationPlatforms,
        PLATFORM_CACHE_TTL_S,
        lambda: insights.station_platforms(
            session, station, train_number, PLATFORM_HISTORY_DAYS
        ),
    )
    for p in platforms.predictions:
        if p.trainNumber == train_number and p.confidence >= PLATFORM_MIN_CONFIDENCE:
            return p.platform
    return None


async def _with_usual_platforms(
    session: AsyncSession,
    redis: Redis,
    observed: list[tuple["FollowInfo", Observation]],
    states: dict[tuple[uuid.UUID, date], AlertState | None],
) -> list[tuple["FollowInfo", Observation]]:
    """Fill in the usual platform of commutes seen for the first time today."""
    result = []
    for follow, obs in observed:
        state = states.get((follow.id, obs.service_date))
        number = (follow.trip_short_name.split() or [""])[0]
        if (
            follow.kind == "commute"
            and follow.from_station_id
            and number
            and follow.alerts_enabled
            and follow.notify_platform_change
            and obs.scheduled_platform is None
            and not obs.departed
            and (
                state is None
                or state.trip_id != obs.trip_id
                or state.last_platform is None
            )
        ):
            try:
                usual = await usual_platform(
                    session, redis, follow.from_station_id, number
                )
            except Exception as e:
                await session.rollback()
                logger.warning(f"Usual platform lookup failed: {e!r}")
                usual = None
            if usual is not None:
                obs = replace(obs, scheduled_platform=usual)
        result.append((follow, obs))
    return result


# --- Evaluation run ---


@dataclass(slots=True)
class Senders:
    expo: ExpoSender
    live_activity: LiveActivitySender


@dataclass(slots=True)
class RunStats:
    evaluated: int = 0
    tracked: int = 0
    alerts: int = 0
    live_activity_updates: int = 0
    failed: int = 0
    errors: int = 0
    skipped_locked: bool = False
    by_kind: dict[str, int] = field(default_factory=lambda: defaultdict(int))

    def as_dict(self) -> dict[str, Any]:
        return {
            "evaluated": self.evaluated,
            "tracked": self.tracked,
            "alerts": self.alerts,
            "liveActivityUpdates": self.live_activity_updates,
            "failed": self.failed,
            "errors": self.errors,
            "skippedLocked": self.skipped_locked,
            "byKind": dict(self.by_kind),
        }


async def load_live_locations(redis: Redis) -> list[dict[str, Any]]:
    raw = await redis.hvals(add_key("train-positions-hash"))  # type: ignore[misc]
    return [json.loads(v) for v in raw]


def _state_from_row(row: NotificationState | None) -> AlertState | None:
    if row is None:
        return None
    return AlertState(
        trip_id=row.trip_id,
        last_delay_min=row.last_delay_min,
        last_platform=row.last_platform,
        last_notified_at=row.last_notified_at,
        train_ahead_notified_at=row.train_ahead_notified_at,
    )


async def _store_state(
    session: AsyncSession, follow_id: uuid.UUID, service_date: date, state: AlertState
) -> None:
    values = {
        "trip_id": state.trip_id,
        "last_delay_min": state.last_delay_min,
        "last_platform": state.last_platform,
        "last_notified_at": state.last_notified_at,
        "train_ahead_notified_at": state.train_ahead_notified_at,
    }
    stmt = insert(NotificationState).values(
        follow_id=follow_id, service_date=service_date, **values
    )
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=[
                NotificationState.follow_id,
                NotificationState.service_date,
            ],
            set_=values,
        )
    )


async def record_results(
    session: AsyncSession, results: Iterable[SendResult], now: datetime
) -> None:
    """Note delivery outcomes on the tokens; dead tokens are deleted."""
    ok, gone = [], []
    for r in results:
        if r.outcome == Outcome.OK:
            ok.append(r.token_id)
        elif r.outcome == Outcome.UNREGISTERED:
            gone.append(r.token_id)
        elif r.outcome == Outcome.FAILED:
            await session.execute(
                update(PushToken)
                .where(PushToken.id == r.token_id)
                .values(
                    failure_count=PushToken.failure_count + 1,
                    last_failure_at=now,
                    last_error=(r.error or "")[:500],
                )
            )
    if ok:
        await session.execute(
            update(PushToken)
            .where(PushToken.id.in_(ok))
            .values(failure_count=0, last_success_at=now)
        )
    if gone:
        logger.info(f"Deleting {len(gone)} unregistered push tokens")
        await session.execute(delete(PushToken).where(PushToken.id.in_(gone)))


# Content changes that are pushed at once; others (progress, times moving
# with the delay) at most every LIVE_ACTIVITY_MIN_INTERVAL_S
LIVE_ACTIVITY_MEANINGFUL = (
    "delayMin",
    "nextStop",
    "platform",
    "platformSure",
    "departed",
)


def live_activity_content(obs: Observation) -> dict[str, Any]:
    """
    The Live Activity's content state. Keys and types must match
    `TrainActivityAttributes.ContentState` in apps/mobile (Swift): an update
    that does not decode is dropped by iOS.
    """
    platform, sure = obs.next_platform, True
    if not obs.departed:
        platform = obs.platform
        if platform is None and obs.scheduled_platform is not None:
            # The usual platform, shown as a guess
            platform, sure = obs.scheduled_platform, False
    return {
        "delayMin": None if obs.delay_min is None else max(obs.delay_min, 0),
        "nextStop": obs.next_stop,
        "nextStopAt": obs.next_stop_at,
        "platform": platform,
        "platformSure": sure,
        "eta": obs.eta,
        "progress": obs.progress,
        "departed": obs.departed,
    }


def live_activity_due(
    content: dict[str, Any],
    last: dict[str, Any] | None,
    last_sent_at: int | None,
    now: int,
) -> bool:
    """Whether a Live Activity needs `content` now (see LIVE_ACTIVITY_MEANINGFUL)."""
    if last is None or last_sent_at is None:
        return True
    if content == last:
        return False
    if any(content.get(k) != last.get(k) for k in LIVE_ACTIVITY_MEANINGFUL):
        return True
    return now - last_sent_at >= LIVE_ACTIVITY_MIN_INTERVAL_S


def live_activity_relevance(obs: Observation, now: int) -> float:
    """Sooner trains rank higher among the app's activities, 1 to 100."""
    if obs.departed or obs.next_stop_at is None:
        return 100.0 if obs.departed else 50.0
    minutes = (obs.next_stop_at - now) / 60
    return float(min(100, max(1, round(100 - minutes))))


async def _last_live_activity(
    redis: Redis, token: TokenInfo
) -> tuple[dict[str, Any] | None, int | None]:
    raw = await redis.get(live_activity_key(token.device_id, token.id))
    if not raw:
        return None, None
    try:
        stored = json.loads(raw)
        return dict(stored["content"]), int(stored["sentAt"])
    except (TypeError, KeyError, ValueError):
        return None, None


async def _active_follows(session: AsyncSession, today: date) -> list[FollowInfo]:
    yesterday = today - timedelta(days=1)
    weekday_mask = (1 << (today.isoweekday() - 1)) | (1 << (yesterday.isoweekday() - 1))
    has_target = exists().where(
        PushToken.device_id == Follow.device_id,
        or_(
            and_(PushToken.type == "expo", Follow.alerts_enabled),
            PushToken.follow_id == Follow.id,
        ),
    )
    rows = await session.execute(
        select(Follow, Device.locale)
        .join(Device, Device.id == Follow.device_id)
        .where(
            or_(
                and_(
                    Follow.kind == "trip",
                    Follow.service_date.between(yesterday, today),
                ),
                and_(
                    Follow.kind == "commute",
                    Follow.weekdays.op("&")(weekday_mask) != 0,
                ),
            ),
            has_target,
        )
        .order_by(Follow.id)
    )
    return [FollowInfo.of(f, locale) for f, locale in rows]


async def evaluate_alerts(
    session: AsyncSession,
    redis: Redis,
    senders: Senders,
    now: datetime | None = None,
) -> RunStats:
    """One evaluation over all active follows. Commits per follow."""
    now = now or datetime.now(UTC)
    stats = RunStats()
    lock_key = add_key("push:evaluate-lock")
    lock_value = str(uuid.uuid4())
    if not await redis.set(lock_key, lock_value, nx=True, ex=LOCK_TTL_S):
        logger.info("Alert evaluation already running; skipped")
        stats.skipped_locked = True
        return stats
    try:
        await _evaluate(session, redis, senders, now, stats)
    finally:
        if await redis.get(lock_key) == lock_value:
            await redis.delete(lock_key)
    logger.info(f"Alert evaluation: {stats.as_dict()}")
    return stats


async def _evaluate(
    session: AsyncSession,
    redis: Redis,
    senders: Senders,
    now: datetime,
    stats: RunStats,
) -> None:
    today = now.astimezone(BUDAPEST_TZ).date()
    follows = await _active_follows(session, today)
    if not follows:
        await session.commit()
        return
    device_ids = {f.device_id for f in follows}
    rows = await session.execute(
        select(
            PushToken.id,
            PushToken.device_id,
            PushToken.type,
            PushToken.token,
            PushToken.follow_id,
        ).where(PushToken.device_id.in_(device_ids))
    )
    expo_by_device: dict[uuid.UUID, list[TokenInfo]] = defaultdict(list)
    la_by_follow: dict[uuid.UUID, list[TokenInfo]] = defaultdict(list)
    for row in rows:
        t = TokenInfo(*row)
        if t.type == "expo":
            expo_by_device[t.device_id].append(t)
        elif t.follow_id is not None and settings.LIVE_ACTIVITY_PUSH_ENABLED:
            la_by_follow[t.follow_id].append(t)

    locations = await load_live_locations(redis)
    live: dict[tuple[str, str], dict[str, Any]] = {}
    for loc in locations:
        trip = loc.get("trip") or {}
        if trip.get("gtfsId") and trip.get("serviceDate"):
            live[(trip["gtfsId"], trip["serviceDate"])] = loc

    observed: list[tuple[FollowInfo, Observation]] = []
    for follow in follows:
        stats.evaluated += 1
        if follow.kind == "trip":
            tracked = track_trip(follow, live)
        else:
            tracked = await track_commute(redis, follow, locations, live, today)
        obs = None if tracked is None else observe(tracked, locations, now)
        if obs is not None:
            observed.append((follow, obs))
    stats.tracked = len(observed)

    states: dict[tuple[uuid.UUID, date], AlertState | None] = {}
    if observed:
        keys = [(f.id, obs.service_date) for f, obs in observed]
        state_rows = await session.scalars(
            select(NotificationState)
            .execution_options(populate_existing=True)
            .where(
                tuple_(NotificationState.follow_id, NotificationState.service_date).in_(
                    keys
                )
            )
        )
        states = {(r.follow_id, r.service_date): _state_from_row(r) for r in state_rows}
    observed = await _with_usual_platforms(session, redis, observed, states)
    # No transaction stays open while sending
    await session.commit()

    for follow, obs in observed:
        previous = states.get((follow.id, obs.service_date))
        try:
            await _process_follow(
                session,
                redis,
                senders,
                follow,
                obs,
                previous,
                expo_by_device.get(follow.device_id, []),
                la_by_follow.get(follow.id, []),
                now,
                stats,
            )
        except Exception as e:
            stats.errors += 1
            await session.rollback()
            logger.exception(f"Alert evaluation failed for follow {follow.id}: {e!r}")


async def _process_follow(
    session: AsyncSession,
    redis: Redis,
    senders: Senders,
    follow: FollowInfo,
    obs: Observation,
    previous: AlertState | None,
    expo_tokens: list[TokenInfo],
    la_tokens: list[TokenInfo],
    now: datetime,
    stats: RunStats,
) -> None:
    decision = decide(follow, obs, previous, now)
    alerts = decision.alerts
    title, body = (
        render(alerts, obs.context, lang_for(follow.locale)) if alerts else ("", None)
    )
    timestamp = int(now.timestamp())
    content = live_activity_content(obs)
    relevance = live_activity_relevance(obs, timestamp)

    la_messages: list[LiveActivityMessage] = []
    la_contents: dict[uuid.UUID, str] = {}
    for token in la_tokens:
        if obs.finished:
            la_messages.append(
                LiveActivityMessage(
                    token.id,
                    token.token,
                    "end",
                    content,
                    timestamp,
                    dismissal_date=timestamp + LIVE_ACTIVITY_DISMISS_S,
                )
            )
            continue
        last, last_sent_at = await _last_live_activity(redis, token)
        if not alerts and not live_activity_due(content, last, last_sent_at, timestamp):
            continue
        la_contents[token.id] = json.dumps({"content": content, "sentAt": timestamp})
        la_messages.append(
            LiveActivityMessage(
                token.id,
                token.token,
                "update",
                content,
                timestamp,
                alert=(title, body) if alerts else None,
                stale_date=timestamp + LIVE_ACTIVITY_STALE_S,
                relevance_score=relevance,
            )
        )

    expo_messages: list[ExpoMessage] = []
    if alerts and not la_tokens:
        data = {
            "followId": str(follow.id),
            "tripId": obs.trip_id,
            "serviceDate": obs.service_date.isoformat(),
            "kinds": [a.kind.value for a in alerts],
        }
        if obs.vehicle_id:
            data["vehicleId"] = obs.vehicle_id
        expo_messages = [
            ExpoMessage(t.id, t.token, title, body, data) for t in expo_tokens
        ]

    if not la_messages and not expo_messages:
        if decision.quiet_state != previous:
            await _store_state(
                session, follow.id, obs.service_date, decision.quiet_state
            )
            await session.commit()
        return

    la_results = await senders.live_activity.send(la_messages) if la_messages else []
    expo_results = await senders.expo.send(expo_messages) if expo_messages else []

    carriers = la_results if la_tokens else expo_results
    delivered = any(r.outcome in DELIVERED for r in carriers)
    stats.live_activity_updates += sum(r.outcome in DELIVERED for r in la_results)
    stats.failed += sum(
        r.outcome not in DELIVERED for r in [*la_results, *expo_results]
    )
    state = decision.state if alerts and delivered else decision.quiet_state
    if alerts and delivered:
        stats.alerts += 1
        for a in alerts:
            stats.by_kind[a.kind.value] += 1

    # The state and the delivery outcome are recorded together
    results = [*la_results, *expo_results]
    if state != previous:
        await _store_state(session, follow.id, obs.service_date, state)
    await record_results(session, results, now)
    if obs.finished:
        # An ended Live Activity cannot be updated again
        ended = [r.token_id for r in la_results if r.outcome != Outcome.FAILED]
        if ended:
            await session.execute(delete(PushToken).where(PushToken.id.in_(ended)))
    await session.commit()

    tokens_by_id = {t.id: t for t in la_tokens}
    for r in la_results:
        if r.outcome in DELIVERED and r.token_id in la_contents:
            await redis.set(
                live_activity_key(tokens_by_id[r.token_id].device_id, r.token_id),
                la_contents[r.token_id],
                ex=LIVE_ACTIVITY_CONTENT_TTL_S,
            )
    tickets = {
        f"{r.ticket_id}|{r.token_id}": now.timestamp()
        for r in expo_results
        if r.outcome == Outcome.OK and r.ticket_id
    }
    if tickets:
        await redis.zadd(receipts_key(), tickets)


async def check_receipts(
    session: AsyncSession, redis: Redis, expo: ExpoSender, now: datetime | None = None
) -> dict[str, int]:
    """
    Fetch Expo receipts of tickets older than RECEIPT_DELAY_S. Tokens whose
    receipt says DeviceNotRegistered are deleted; other errors count as
    failures. Commits.
    """
    now = now or datetime.now(UTC)
    key = receipts_key()
    cutoff = now.timestamp() - RECEIPT_DELAY_S
    # Receipts are gone after a day
    expired = await redis.zremrangebyscore(
        key, "-inf", now.timestamp() - RECEIPT_MAX_AGE_S
    )
    members = await redis.zrangebyscore(key, "-inf", cutoff, start=0, num=1000)
    if not members:
        return {"checked": 0, "unregistered": 0, "failed": 0, "expired": expired}

    token_by_ticket: dict[str, uuid.UUID] = {}
    for member in members:
        ticket_id, _, token_id = member.partition("|")
        try:
            token_by_ticket[ticket_id] = uuid.UUID(token_id)
        except ValueError:
            continue
    receipts = await expo.receipts(list(token_by_ticket))

    results = []
    for ticket_id, receipt in receipts.items():
        token_id = token_by_ticket.get(ticket_id)
        if token_id is not None and receipt.outcome != Outcome.OK:
            results.append(replace(receipt, token_id=token_id))
    await record_results(session, results, now)
    await session.commit()

    done = [f"{t}|{token_by_ticket[t]}" for t in receipts if t in token_by_ticket]
    if done:
        await redis.zrem(key, *done)
    stats = {
        "checked": len(receipts),
        "unregistered": sum(r.outcome == Outcome.UNREGISTERED for r in results),
        "failed": sum(r.outcome == Outcome.FAILED for r in results),
        "expired": expired,
    }
    logger.info(f"Expo receipts: {stats}")
    return stats
