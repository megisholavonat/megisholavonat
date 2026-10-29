"""
One run of a train on one service date, for the delay summary card ("the
7:15 was 23 minutes late today").

The delays come from stop_delay_observations (our GPS-derived delay at each
stop the recorder saw the train pass, the arrival delay at the final stop).
The full stop list, cancellations and the delay reason come from the
timetable (OTP) for the recorded trip; a run that was never recorded (a
cancelled train, one that has not left yet) is looked up among the live
trains instead.

Dates are effective service dates: the day the stoptimes count from, which
OTP's own `serviceDate` misses by a day for HÉVs after midnight and train 10
(see `api.util.trip.seconds_into_service_day`).
"""

import json
import statistics
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.graphql import UpstreamError, query_graphql
from api.core.logging_config import get_logger
from api.core.queries import RUN_TRIP_QUERY
from api.core.redis import add_key
from api.schemas.alerts import DelayReason
from api.schemas.runs import RunStop, RunSummary
from api.util.route_names import route_name
from api.util.stop import station_id
from api.util.time import BUDAPEST_TZ, get_seconds_since_day, service_day_start
from api.util.trip import seconds_into_service_day

logger = get_logger(__name__)

DAY_S = 24 * 3600
# An observation more than this far from its service date's clock belongs to
# the neighbouring service date (see the module docstring)
SHIFT_AFTER_S = 12 * 3600
# A run is over this long after its last scheduled arrival, even if its
# arrival was not recorded
FINISHED_AFTER_S = 3 * 3600
# How far back a run can be asked for: the raw history is kept 13 months
MAX_AGE_DAYS = 400

# Cache: a run that is over does not change any more; one under way does
CACHE_TTL_FINISHED_S = 6 * 3600
CACHE_TTL_LIVE_S = 60
UPSTREAM_TIMEOUT_S = 8.0


def today() -> date:
    """Today in Budapest (tests replace it)."""
    return datetime.now(BUDAPEST_TZ).date()


@dataclass
class _Run:
    """The observations of one (OTP service date, trip) pair."""

    service_date: date
    trip_id: str
    rows: list[Any]

    @property
    def shift_days(self) -> int:
        """
        Days between OTP's service date and the one the stoptimes really
        count from, by when the passages were seen: the median of
        (seen - (schedule + delay)) is about 0 on the right date.
        """
        start = service_day_start(self.service_date)
        offsets: list[float] = []
        for r in self.rows:
            scheduled = r.scheduled_departure_s
            if scheduled is None:
                scheduled = r.scheduled_arrival_s
            if scheduled is None:
                continue
            expected = start + timedelta(seconds=scheduled + r.delay_s)
            offsets.append((r.observed_at - expected).total_seconds())
        if not offsets:
            return 0
        offset = statistics.median(offsets)
        if abs(offset) < SHIFT_AFTER_S:
            return 0
        return round(offset / DAY_S)

    @property
    def effective_date(self) -> date:
        return self.service_date + timedelta(days=self.shift_days)


async def _observed_runs(
    session: AsyncSession, train_number: str, day: date
) -> list[_Run]:
    """Recorded runs of the train on OTP service dates next to `day`."""
    result = await session.execute(
        text(
            """
            SELECT o.service_date, o.trip_gtfs_id, o.stop_sequence,
                   o.trip_short_name, o.route_short_name, o.station_id,
                   s.name, o.scheduled_arrival_s, o.scheduled_departure_s,
                   o.delay_s, o.observed_at
            FROM stop_delay_observations o
            LEFT JOIN stops s ON s.gtfs_id = o.stop_id
            WHERE o.service_date BETWEEN :start AND :end
              AND split_part(o.trip_short_name, ' ', 1) = :train
            ORDER BY o.service_date, o.trip_gtfs_id, o.stop_sequence
            """
        ),
        {
            "start": day - timedelta(days=1),
            "end": day + timedelta(days=1),
            "train": train_number,
        },
    )
    groups: dict[tuple[date, str], list[Any]] = defaultdict(list)
    for row in result:
        groups[(row.service_date, row.trip_gtfs_id)].append(row)
    return [_Run(d, trip, rows) for (d, trip), rows in groups.items()]


def _departure_s(run: _Run, station: str) -> int | None:
    for r in run.rows:
        if r.station_id == station:
            seconds: int | None = r.scheduled_departure_s or r.scheduled_arrival_s
            return seconds
    return None


def pick_run(runs: list[_Run], day: date, from_station: str | None) -> _Run | None:
    """
    The run of `day`. Failing that, with a boarding station, the previous
    day's run that leaves that station after midnight, on `day` (a follow
    knows the local date of boarding, not of the departure from the origin).
    """
    on_day = [r for r in runs if r.effective_date == day]
    if not on_day and from_station:
        on_day = [
            r
            for r in runs
            if r.effective_date == day - timedelta(days=1)
            and (_departure_s(r, from_station) or 0) >= DAY_S
        ]
    if not on_day:
        return None
    # Train numbers can repeat on one day: the run seen at the most stops
    return max(on_day, key=lambda r: (len(r.rows), r.trip_id))


async def _timetable(trip_id: str, service_date: date) -> dict[str, Any] | None:
    """The trip's stops on its OTP service date, or None if unavailable."""
    try:
        data = await query_graphql(
            RUN_TRIP_QUERY,
            {"id": trip_id, "date": service_date.strftime("%Y%m%d")},
            timeout=UPSTREAM_TIMEOUT_S,
        )
    except (UpstreamError, ValueError) as e:
        logger.warning(f"Run summary: no timetable for {trip_id}: {e}")
        return None
    trip = data.get("trip")
    if not isinstance(trip, dict) or not trip.get("stoptimesForDate"):
        return None
    return trip


def _reason(trip: dict[str, Any] | None) -> DelayReason | None:
    alerts = (trip or {}).get("alerts") or []
    return DelayReason.from_texts(*(a.get("alertDescriptionText") for a in alerts))


def _stops_from_timetable(
    stoptimes: list[dict[str, Any]], delays: dict[int, int]
) -> list[RunStop]:
    """Timetable stops with the recorded delays by stop index."""
    stops = []
    for i, st in enumerate(stoptimes):
        stop = st.get("stop") or {}
        delay = delays.get(i)
        stops.append(
            RunStop(
                stationId=station_id(stop) or "",
                name=stop.get("name") or "",
                scheduledArrivalS=st.get("scheduledArrival"),
                scheduledDepartureS=st.get("scheduledDeparture"),
                delayMin=None if delay is None else round(delay / 60, 1),
                cancelled=st.get("realtimeState") == "CANCELED",
            )
        )
    return stops


def _summary(
    *,
    train_number: str,
    trip_short_name: str,
    route_short_name: str | None,
    day: date,
    stops: list[RunStop],
    complete: bool,
    reason: DelayReason | None,
    now: float,
) -> RunSummary:
    cancelled = bool(stops) and all(s.cancelled for s in stops)
    last = stops[-1] if stops else None
    arrived = complete and last is not None and last.delayMin is not None
    end_s = None
    if last is not None:
        end_s = last.scheduledArrivalS or last.scheduledDepartureS
    over = end_s is not None and (
        service_day_start(day).timestamp() + end_s + FINISHED_AFTER_S < now
    )
    return RunSummary(
        trainNumber=train_number,
        tripShortName=trip_short_name,
        routeShortName=route_short_name or None,
        lineName=route_name(route_short_name),
        serviceDate=day,
        stops=stops,
        complete=complete,
        cancelled=cancelled,
        finished=arrived or over,
        reason=reason,
    )


async def _from_observations(run: _Run, now: float) -> RunSummary:
    first = run.rows[0]
    delays = {r.stop_sequence: r.delay_s for r in run.rows}
    trip = await _timetable(run.trip_id, run.service_date)
    stoptimes = (trip or {}).get("stoptimesForDate") or []
    # The recorded stop indexes must point at the same stations
    matches = bool(stoptimes) and all(
        r.stop_sequence < len(stoptimes)
        and station_id(stoptimes[r.stop_sequence].get("stop") or {}) == r.station_id
        for r in run.rows
    )
    if matches:
        stops = _stops_from_timetable(stoptimes, delays)
        complete = True
    else:
        stops = [
            RunStop(
                stationId=r.station_id,
                name=r.name or r.station_id,
                scheduledArrivalS=r.scheduled_arrival_s,
                scheduledDepartureS=r.scheduled_departure_s,
                delayMin=round(r.delay_s / 60, 1),
            )
            for r in run.rows
        ]
        complete = False
    return _summary(
        train_number=first.trip_short_name.split(" ", 1)[0],
        trip_short_name=first.trip_short_name,
        route_short_name=first.route_short_name,
        day=run.effective_date,
        stops=stops,
        complete=complete,
        reason=_reason(trip),
        now=now,
    )


def _live_effective_date(trip: dict[str, Any], at: float) -> date | None:
    try:
        raw = date.fromisoformat(trip.get("serviceDate") or "")
    except ValueError:
        return None
    when = datetime.fromtimestamp(at, tz=UTC)
    shift = get_seconds_since_day(raw.isoformat(), when) - seconds_into_service_day(
        trip, at
    )
    return raw + timedelta(days=round(shift / DAY_S))


async def _from_live(
    redis: Redis, train_number: str, day: date, now: float
) -> RunSummary | None:
    """A run on the map that was never recorded: cancelled, or not left yet."""
    raw = await redis.hvals(add_key("train-positions-hash"))  # type: ignore[misc]
    needle = f"{train_number} "
    for value in raw:
        # Cheap check before parsing every live train
        if needle not in value and f'"{train_number}"' not in value:
            continue
        location = json.loads(value)
        trip = location.get("trip") or {}
        name: str = trip.get("tripShortName") or ""
        if name.split(" ", 1)[0] != train_number:
            continue
        at = location.get("lastUpdated") or now
        effective = _live_effective_date(trip, at)
        if effective != day:
            continue
        stops = _stops_from_timetable(trip.get("stoptimes") or [], {})
        if not stops:
            continue
        return _summary(
            train_number=train_number,
            trip_short_name=name,
            route_short_name=(trip.get("route") or {}).get("shortName"),
            day=day,
            stops=stops,
            complete=True,
            reason=_reason(trip),
            now=now,
        )
    return None


async def build_run_summary(
    session: AsyncSession,
    redis: Redis,
    train_number: str,
    day: date,
    from_station: str | None = None,
    now: float | None = None,
) -> RunSummary | None:
    """The run of a train on an (effective) service date, or None if unknown."""
    if now is None:
        now = time.time()
    run = pick_run(await _observed_runs(session, train_number, day), day, from_station)
    if run is not None:
        return await _from_observations(run, now)
    return await _from_live(redis, train_number, day, now)


def in_range(day: date) -> bool:
    """Whether a run on `day` can be on record: not in the future or too old."""
    current = today()
    return current - timedelta(days=MAX_AGE_DAYS) <= day <= current + timedelta(days=1)


async def run_summary(
    session: AsyncSession,
    redis: Redis,
    train_number: str,
    day: date,
    from_station: str | None = None,
) -> RunSummary | None:
    """`build_run_summary`, cached in Redis; a finished run for longer."""
    key = add_key(f"history:run:{train_number}:{day.isoformat()}:{from_station or ''}")
    try:
        cached = await redis.get(key)
    except Exception as e:
        logger.warning(f"Cache read failed for {key}: {e}")
        cached = None
    if cached:
        return RunSummary.model_validate_json(cached)

    summary = await build_run_summary(session, redis, train_number, day, from_station)
    if summary is None:
        return None
    ttl = CACHE_TTL_FINISHED_S if summary.finished else CACHE_TTL_LIVE_S
    try:
        await redis.set(key, summary.model_dump_json(), ex=ttl)
    except Exception as e:
        logger.warning(f"Cache write failed for {key}: {e}")
    return summary
