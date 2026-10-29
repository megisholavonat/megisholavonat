import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

import fakeredis
import pytest
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.models.devices import Device, Follow, NotificationState, PushToken
from api.models.history import Stop, StopDelayObservation
from api.services import insights, push_alerts
from api.services.history import ensure_partition
from api.services.push_alerts import (
    AlertState,
    Observation,
    Senders,
    TrainAhead,
    check_receipts,
    decide,
    evaluate_alerts,
    find_train_ahead,
    live_activity_content,
    live_activity_due,
    live_activity_relevance,
    receipts_key,
    train_label,
    usual_platform,
)
from api.services.push_copy import Alert, AlertKind, TrainContext, lang_for, render
from api.services.push_senders import Outcome, SendResult
from api.util.stop import platform_from_gtfs_id
from tests.push_fakes import (
    DELI,
    FEHERVAR,
    KELENFOLD,
    NOW,
    S70_STOPS,
    TODAY,
    TUESDAY_ONLY,
    WEDNESDAY_ONLY,
    FakeExpo,
    FakeLiveActivity,
    location,
    set_live,
)

EXPO_TOKEN = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]"
LA_TOKEN = "ab" * 32
MIN = timedelta(minutes=1)


# --- Pure rules ---


@dataclass
class Prefs:
    alerts_enabled: bool = True
    delay_threshold_min: int = 5
    notify_platform_change: bool = True


def obs(**kw: Any) -> Observation:
    values: dict[str, Any] = {
        "trip_id": "1:s70",
        "service_date": TODAY,
        "context": TrainContext("S70", "Kelenföld", "14:32"),
        "delay_min": 0,
        "platform": "3",
        "scheduled_platform": "3",
        "departed": False,
        "finished": False,
    }
    values.update(kw)
    return Observation(**values)


def kinds(alerts: list[Alert]) -> list[AlertKind]:
    return [a.kind for a in alerts]


def test_delay_must_exceed_threshold() -> None:
    assert decide(Prefs(), obs(delay_min=5), None, NOW).alerts == []
    d = decide(Prefs(), obs(delay_min=6), None, NOW)
    assert d.alerts == [Alert(AlertKind.DELAY, delay_min=6)]
    assert d.state.last_delay_min == 6
    assert d.state.last_notified_at == NOW


@pytest.mark.parametrize(
    ("delay", "expected"),
    [(13, []), (16, []), (17, [AlertKind.DELAY]), (8, []), (7, [AlertKind.DELAY])],
)
def test_delay_realerts_on_five_minute_change(
    delay: int, expected: list[AlertKind]
) -> None:
    state = AlertState("1:s70", last_delay_min=12, last_notified_at=NOW - 10 * MIN)
    assert kinds(decide(Prefs(), obs(delay_min=delay), state, NOW).alerts) == expected


def test_back_on_time_once() -> None:
    state = AlertState("1:s70", last_delay_min=12, last_notified_at=NOW - 10 * MIN)
    d = decide(Prefs(), obs(delay_min=5), state, NOW)
    assert kinds(d.alerts) == [AlertKind.ON_TIME]
    assert d.state.last_delay_min == 5
    # Already told
    assert decide(Prefs(), obs(delay_min=2), d.state, NOW + 10 * MIN).alerts == []


def test_quiet_interval_holds_alerts() -> None:
    state = AlertState("1:s70", last_delay_min=12, last_notified_at=NOW - 4 * MIN)
    held = decide(Prefs(), obs(delay_min=20), state, NOW)
    assert held.alerts == []
    assert held.state.last_delay_min == 12
    assert held.state.last_notified_at == state.last_notified_at
    later = decide(Prefs(), obs(delay_min=20), state, NOW + MIN)
    assert kinds(later.alerts) == [AlertKind.DELAY]


def test_platform_change_against_schedule_then_last_notified() -> None:
    d = decide(Prefs(), obs(platform="5"), None, NOW)
    assert d.alerts == [Alert(AlertKind.PLATFORM, platform="5")]
    assert d.state.last_platform == "5"
    # Same platform again: nothing; back to 3: alert
    assert decide(Prefs(), obs(platform="5"), d.state, NOW + 10 * MIN).alerts == []
    back = decide(Prefs(), obs(platform="3"), d.state, NOW + 10 * MIN)
    assert kinds(back.alerts) == [AlertKind.PLATFORM]


def test_platform_baseline_without_schedule() -> None:
    d = decide(Prefs(), obs(platform="7", scheduled_platform=None), None, NOW)
    assert d.alerts == []
    assert d.quiet_state.last_platform == "7"
    changed = decide(
        Prefs(), obs(platform="8", scheduled_platform=None), d.quiet_state, NOW
    )
    assert kinds(changed.alerts) == [AlertKind.PLATFORM]


def test_platform_ignored_after_departure_or_when_disabled() -> None:
    assert decide(Prefs(), obs(platform="5", departed=True), None, NOW).alerts == []
    off = Prefs(notify_platform_change=False)
    assert decide(off, obs(platform="5"), None, NOW).alerts == []


def test_quiet_after_alighting_station() -> None:
    d = decide(Prefs(), obs(delay_min=30, platform="9", finished=True), None, NOW)
    assert d.alerts == []


def test_alerts_disabled() -> None:
    assert (
        decide(Prefs(alerts_enabled=False), obs(delay_min=30), None, NOW).alerts == []
    )


def test_alerts_due_together_are_combined() -> None:
    d = decide(Prefs(), obs(delay_min=12, platform="5"), None, NOW)
    assert kinds(d.alerts) == [AlertKind.DELAY, AlertKind.PLATFORM]


def test_new_trip_starts_over() -> None:
    state = AlertState("1:other", last_delay_min=12, last_notified_at=NOW)
    d = decide(Prefs(), obs(delay_min=12), state, NOW)
    assert kinds(d.alerts) == [AlertKind.DELAY]
    assert d.state.trip_id == "1:s70"


def test_train_ahead_once_and_only_before_departure() -> None:
    ahead = TrainAhead("S70", 18)
    d = decide(Prefs(), obs(train_ahead=ahead), None, NOW)
    assert d.alerts == [Alert(AlertKind.TRAIN_AHEAD, delay_min=18)]
    assert d.state.train_ahead_notified_at == NOW
    assert decide(Prefs(), obs(train_ahead=ahead), d.state, NOW + 30 * MIN).alerts == []
    assert (
        decide(Prefs(), obs(train_ahead=ahead, departed=True), None, NOW).alerts == []
    )
    # Our own delay already says it
    late = decide(Prefs(), obs(train_ahead=ahead, delay_min=9), None, NOW)
    assert kinds(late.alerts) == [AlertKind.DELAY]


# --- Train ahead ---


def ahead_location(
    trip_id: str, kelenfold_s: int, delay: int, stops: list[tuple[str, str, int, str]]
) -> dict[str, Any]:
    stops = [
        (uic, n, kelenfold_s if uic == KELENFOLD else t, p) for uic, n, t, p in stops
    ]
    return location(
        trip_id, delay=delay, stops=stops, passed=0, name="5121 személyvonat"
    )


def test_train_ahead_is_the_previous_train_on_the_segment() -> None:
    ours = location(passed=-1)
    previous = ahead_location("1:prev", 14 * 3600 + 15 * 60, 18, S70_STOPS)
    earlier = ahead_location("1:earlier", 13 * 3600 + 45 * 60, 40, S70_STOPS)
    assert find_train_ahead([ours, previous, earlier], ours, 1) == TrainAhead("S70", 18)

    on_time_previous = ahead_location("1:prev", 14 * 3600 + 15 * 60, 14, S70_STOPS)
    assert find_train_ahead([ours, on_time_previous, earlier], ours, 1) is None


def test_train_ahead_ignores_other_segments_and_later_trains() -> None:
    ours = location(passed=-1)
    # Opposite direction: Kelenföld before Déli
    reverse = location(
        "1:rev",
        stops=[S70_STOPS[1], (DELI, "Budapest-Déli", 14 * 3600 + 40 * 60, "1")],
        delay=30,
    )
    reverse["trip"]["stoptimes"][0]["scheduledArrival"] = 14 * 3600 + 20 * 60
    later = ahead_location("1:later", 14 * 3600 + 50 * 60, 30, S70_STOPS)
    too_early = ahead_location("1:early", 13 * 3600 + 20 * 60, 30, S70_STOPS)
    assert find_train_ahead([ours, reverse, later, too_early], ours, 1) is None
    # Boarding at the origin: no segment into it
    assert find_train_ahead([ours, later], ours, 0) is None


# --- Copy ---


def test_copy_by_locale() -> None:
    ctx = TrainContext("S70", "Kelenföld", "14:32")
    delay = [Alert(AlertKind.DELAY, delay_min=12)]
    assert render(delay, ctx, "hu") == ("S70 · +12 perc · Kelenföld 14:32", None)
    assert render(delay, ctx, "en") == ("S70 · +12 min · Kelenföld 14:32", None)
    assert render([Alert(AlertKind.ON_TIME)], ctx, "hu")[0] == (
        "S70 · újra időben · Kelenföld 14:32"
    )
    assert render([Alert(AlertKind.PLATFORM, platform="5")], ctx, "en")[0] == (
        "S70 · new platform: 5 · Kelenföld 14:32"
    )
    assert render([Alert(AlertKind.TRAIN_AHEAD, delay_min=18)], ctx, "hu") == (
        "S70 · előző vonat +18 perc · Kelenföld 14:32",
        "A tiéd is késhet.",
    )
    both = [
        Alert(AlertKind.DELAY, delay_min=12),
        Alert(AlertKind.PLATFORM, platform="5"),
    ]
    assert render(both, ctx, "hu")[0] == (
        "S70 · +12 perc · új vágány: 5 · Kelenföld 14:32"
    )


@pytest.mark.parametrize(
    ("locale", "lang"),
    [(None, "hu"), ("hu", "hu"), ("hu-HU", "hu"), ("en-GB", "en"), ("de", "en")],
)
def test_lang_for(locale: str | None, lang: str) -> None:
    assert lang_for(locale) == lang


def test_train_label_and_platform_from_gtfs_id() -> None:
    assert (
        train_label({"route": {"shortName": "S70"}, "tripShortName": "5123"}) == "S70"
    )
    assert (
        train_label({"route": {"shortName": "IC"}, "tripShortName": "559 AGRIA"})
        == "IC 559"
    )
    assert platform_from_gtfs_id("1:005501024_14") == "14"
    assert platform_from_gtfs_id("1:005505876_5b") == "5b"
    assert platform_from_gtfs_id("1:005501024") is None


# --- Evaluation against the database ---


@pytest.fixture
def expo() -> FakeExpo:
    return FakeExpo()


@pytest.fixture
def live_activity() -> FakeLiveActivity:
    return FakeLiveActivity()


@pytest.fixture
def senders(expo: FakeExpo, live_activity: FakeLiveActivity) -> Senders:
    return Senders(expo=expo, live_activity=live_activity)


async def add_device(
    session: AsyncSession, locale: str | None = "hu", platform: str = "ios"
) -> Device:
    device = Device(id=uuid.uuid4(), token_hash=b"x", platform=platform, locale=locale)
    session.add(device)
    await session.flush()
    return device


async def add_token(
    session: AsyncSession,
    device: Device,
    token: str = EXPO_TOKEN,
    follow: Follow | None = None,
) -> PushToken:
    push_token = PushToken(
        id=uuid.uuid4(),
        device_id=device.id,
        type="liveactivity" if follow else "expo",
        token=token,
        follow_id=follow.id if follow else None,
    )
    session.add(push_token)
    await session.flush()
    return push_token


async def follow_trip(
    session: AsyncSession, device: Device, from_platform: str = "3", **kw: Any
) -> Follow:
    kw.setdefault("id", uuid.uuid4())
    follow = Follow(
        device_id=device.id,
        kind="trip",
        trip_short_name="5123",
        trip_id="1:s70",
        service_date=TODAY,
        from_stop_id=f"1:{KELENFOLD}_{from_platform}",
        to_stop_id=f"1:{FEHERVAR}_4",
        **kw,
    )
    session.add(follow)
    await session.flush()
    return follow


async def state_of(session: AsyncSession, follow: Follow) -> NotificationState | None:
    return await session.get(
        NotificationState, (follow.id, TODAY), populate_existing=True
    )


async def run(
    session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    at: datetime = NOW,
) -> push_alerts.RunStats:
    return await evaluate_alerts(session, redis, senders, now=at)


async def test_delay_alert_is_sent_and_recorded(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    expo: FakeExpo,
) -> None:
    device = await add_device(db_session)
    token = await add_token(db_session, device)
    follow = await follow_trip(db_session, device)
    await set_live(redis, location(delay=12, passed=-1))

    stats = await run(db_session, redis, senders)
    assert stats.alerts == 1
    assert [m.title for m in expo.sent] == ["S70 · +12 perc · Kelenföld 14:32"]
    assert expo.sent[0].data["followId"] == str(follow.id)
    assert expo.sent[0].data["tripId"] == "1:s70"
    assert expo.sent[0].data["vehicleId"] == "veh-1:s70"

    state = await state_of(db_session, follow)
    assert state is not None
    assert state.last_delay_min == 12
    assert state.last_platform == "3"
    assert state.last_notified_at == NOW
    assert state.trip_id == "1:s70"
    await db_session.refresh(token)
    assert token.last_success_at == NOW
    assert await redis.zcard(receipts_key()) == 1

    # Unchanged: nothing more; 5 minutes later and 5 minutes later: again
    await run(db_session, redis, senders, NOW + 6 * MIN)
    assert len(expo.sent) == 1
    await set_live(redis, location(delay=17, passed=-1))
    await run(db_session, redis, senders, NOW + 7 * MIN)
    assert expo.sent[-1].title == "S70 · +17 perc · Kelenföld 14:32"

    # Back on time once
    await set_live(redis, location(delay=3, passed=0))
    await run(db_session, redis, senders, NOW + 13 * MIN)
    await run(db_session, redis, senders, NOW + 20 * MIN)
    assert [m.title for m in expo.sent[2:]] == ["S70 · újra időben · Kelenföld 14:32"]


async def test_english_copy(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    expo: FakeExpo,
) -> None:
    device = await add_device(db_session, locale="en-GB", platform="android")
    await add_token(db_session, device)
    await follow_trip(db_session, device)
    await set_live(redis, location(delay=12, passed=-1, platforms={1: "5"}))

    await run(db_session, redis, senders)
    assert [m.title for m in expo.sent] == [
        "S70 · +12 min · new platform: 5 · Kelenföld 14:32"
    ]


async def test_quiet_window(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    expo: FakeExpo,
) -> None:
    device = await add_device(db_session)
    await add_token(db_session, device)
    await follow_trip(db_session, device)
    await set_live(redis, location(delay=12, passed=-1))
    await run(db_session, redis, senders)

    await set_live(redis, location(delay=12, passed=-1, platforms={1: "6"}))
    await run(db_session, redis, senders, NOW + 2 * MIN)
    assert len(expo.sent) == 1
    await run(db_session, redis, senders, NOW + 5 * MIN)
    assert expo.sent[-1].title == "S70 · új vágány: 6 · Kelenföld 14:32"


async def test_platform_change_and_departure(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    expo: FakeExpo,
) -> None:
    device = await add_device(db_session)
    await add_token(db_session, device)
    follow = await follow_trip(db_session, device)
    # Already left Kelenföld: a platform difference no longer matters
    await set_live(redis, location(passed=1, platforms={1: "5"}))
    await run(db_session, redis, senders)
    assert expo.sent == []
    state = await state_of(db_session, follow)
    assert state is None or state.last_platform is None


async def test_nothing_after_alighting_station(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    expo: FakeExpo,
) -> None:
    device = await add_device(db_session)
    await add_token(db_session, device)
    await follow_trip(db_session, device)
    await set_live(redis, location(delay=25, passed=3))
    await run(db_session, redis, senders)
    assert expo.sent == []


async def test_follow_without_live_train_or_other_day(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    expo: FakeExpo,
) -> None:
    device = await add_device(db_session)
    await add_token(db_session, device)
    follow = await follow_trip(db_session, device)
    follow.service_date = TODAY - timedelta(days=3)
    await db_session.flush()
    await set_live(redis, location(delay=25, passed=-1))
    stats = await run(db_session, redis, senders)
    assert stats.evaluated == 0
    assert expo.sent == []


async def test_alerts_disabled_and_no_token(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    expo: FakeExpo,
) -> None:
    muted = await add_device(db_session)
    await add_token(db_session, muted)
    await follow_trip(db_session, muted, alerts_enabled=False)
    tokenless = await add_device(db_session)
    await follow_trip(db_session, tokenless)
    await set_live(redis, location(delay=25, passed=-1))
    stats = await run(db_session, redis, senders)
    assert stats.evaluated == 0
    assert expo.sent == []


async def add_commute(
    session: AsyncSession, device: Device, weekdays: int, to_station: str | None = None
) -> Follow:
    follow = Follow(
        id=uuid.uuid4(),
        device_id=device.id,
        kind="commute",
        trip_short_name="5123",
        weekdays=weekdays,
        from_station_id=KELENFOLD,
        to_station_id=to_station,
    )
    session.add(follow)
    await session.flush()
    return follow


async def test_commute_on_a_day_it_runs(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    expo: FakeExpo,
) -> None:
    device = await add_device(db_session)
    await add_token(db_session, device)
    follow = await add_commute(db_session, device, TUESDAY_ONLY, FEHERVAR)
    await set_live(redis, location(delay=9, passed=-1, platforms={1: "4"}))

    await run(db_session, redis, senders)
    # No scheduled platform for a commute: the first one seen is the baseline
    assert [m.title for m in expo.sent] == ["S70 · +9 perc · Kelenföld 14:32"]
    state = await state_of(db_session, follow)
    assert state is not None
    assert state.last_platform == "4"


async def test_commute_on_a_day_it_does_not_run(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    expo: FakeExpo,
) -> None:
    device = await add_device(db_session)
    await add_token(db_session, device)
    await add_commute(db_session, device, WEDNESDAY_ONLY)
    await set_live(redis, location(delay=9, passed=-1))
    stats = await run(db_session, redis, senders)
    assert stats.evaluated == 0
    assert expo.sent == []

    # Monday's commute does not pick up Tuesday's train either
    other = await add_device(db_session)
    await add_token(db_session, other, "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]")
    await add_commute(db_session, other, 1)
    stats = await run(db_session, redis, senders)
    assert stats.evaluated == 1
    assert stats.tracked == 0
    assert expo.sent == []


async def test_train_ahead_alert_once_per_day(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    expo: FakeExpo,
) -> None:
    device = await add_device(db_session)
    await add_token(db_session, device)
    follow = await follow_trip(db_session, device)
    previous = ahead_location("1:prev", 14 * 3600 + 15 * 60, 18, S70_STOPS)
    await set_live(redis, location(passed=-1), previous)

    await run(db_session, redis, senders)
    assert [(m.title, m.body) for m in expo.sent] == [
        ("S70 · előző vonat +18 perc · Kelenföld 14:32", "A tiéd is késhet.")
    ]
    state = await state_of(db_session, follow)
    assert state is not None
    assert state.train_ahead_notified_at == NOW

    await run(db_session, redis, senders, NOW + 30 * MIN)
    assert len(expo.sent) == 1


async def test_unregistered_token_is_deleted(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    expo: FakeExpo,
) -> None:
    device = await add_device(db_session)
    token = await add_token(db_session, device)
    follow = await follow_trip(db_session, device)
    expo.outcomes[EXPO_TOKEN] = Outcome.UNREGISTERED
    await set_live(redis, location(delay=12, passed=-1))

    await run(db_session, redis, senders)
    assert await db_session.get(PushToken, token.id, populate_existing=True) is None
    # Not delivered anywhere, so the alert state did not advance
    state = await state_of(db_session, follow)
    assert state is not None
    assert state.last_notified_at is None


async def test_failed_delivery_is_retried(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    expo: FakeExpo,
) -> None:
    device = await add_device(db_session)
    token = await add_token(db_session, device)
    await follow_trip(db_session, device)
    expo.outcomes[EXPO_TOKEN] = Outcome.FAILED
    await set_live(redis, location(delay=12, passed=-1))

    await run(db_session, redis, senders)
    await db_session.refresh(token)
    assert token.failure_count == 1
    del expo.outcomes[EXPO_TOKEN]
    await run(db_session, redis, senders, NOW + MIN)
    assert len(expo.sent) == 2
    await db_session.refresh(token)
    assert token.failure_count == 0


async def test_receipt_device_not_registered_deletes_token(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    expo: FakeExpo,
) -> None:
    device = await add_device(db_session)
    token = await add_token(db_session, device)
    await follow_trip(db_session, device)
    await set_live(redis, location(delay=12, passed=-1))
    await run(db_session, redis, senders)

    # Not ready yet
    assert (await check_receipts(db_session, redis, expo, NOW + MIN))["checked"] == 0
    expo.receipt_results["ticket-1"] = SendResult(
        uuid.UUID(int=0), Outcome.UNREGISTERED, "DeviceNotRegistered"
    )
    stats = await check_receipts(db_session, redis, expo, NOW + 16 * MIN)
    assert stats["unregistered"] == 1
    assert await db_session.get(PushToken, token.id, populate_existing=True) is None
    assert await redis.zcard(receipts_key()) == 0


async def test_live_activity_updates_and_ends(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    expo: FakeExpo,
    live_activity: FakeLiveActivity,
) -> None:
    device = await add_device(db_session)
    await add_token(db_session, device)
    follow = await follow_trip(db_session, device)
    la = await add_token(db_session, device, LA_TOKEN, follow)
    await set_live(redis, location(delay=12, passed=-1))

    await run(db_session, redis, senders)
    # The alert rides on the Live Activity instead of a second notification
    assert expo.sent == []
    [update] = live_activity.sent
    assert update.event == "update"
    assert update.alert == ("S70 · +12 perc · Kelenföld 14:32", None)
    assert update.stale_date == int(NOW.timestamp()) + 10 * 60
    # Departing 14:44 at 14:00
    assert update.relevance_score == 56.0
    # Before departure: the boarding station, its expected departure
    assert update.content_state == {
        "delayMin": 12,
        "nextStop": "Kelenföld",
        "nextStopAt": budapest("2026-10-27T14:44"),
        "platform": "3",
        "platformSure": True,
        "eta": budapest("2026-10-27T15:42"),
        "progress": 0.0,
        "departed": False,
    }

    # Same content: no update; moved on: silent update at once
    await run(db_session, redis, senders, NOW + MIN)
    assert len(live_activity.sent) == 1
    await set_live(redis, location(delay=13, passed=1))
    await run(db_session, redis, senders, NOW + 2 * MIN)
    last = live_activity.sent[-1]
    assert last.alert is None
    assert last.relevance_score == 100.0
    assert last.content_state["nextStop"] == "Érd"
    assert last.content_state["nextStopAt"] == budapest("2026-10-27T14:58")
    assert last.content_state["platform"] == "2"
    assert last.content_state["departed"] is True

    # Past the alighting station: end, and the token is gone
    await set_live(redis, location(delay=13, passed=3))
    await run(db_session, redis, senders, NOW + 60 * MIN)
    assert live_activity.sent[-1].event == "end"
    assert live_activity.sent[-1].content_state["progress"] == 1.0
    assert await db_session.get(PushToken, la.id, populate_existing=True) is None
    assert expo.sent == []


def budapest(local: str) -> int:
    return int(datetime.fromisoformat(f"{local}+01:00").timestamp())


async def test_live_activity_progress_is_throttled(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    live_activity: FakeLiveActivity,
) -> None:
    device = await add_device(db_session)
    follow = await follow_trip(db_session, device, delay_threshold_min=30)
    await add_token(db_session, device, LA_TOKEN, follow)
    # On board between Érd (14:45) and Székesfehérvár (15:30), on time
    await set_live(redis, location(delay=0, passed=2))
    start = datetime.fromisoformat("2026-10-27T15:00:00+01:00")

    await run(db_session, redis, senders, start)
    assert len(live_activity.sent) == 1
    assert live_activity.sent[-1].content_state["progress"] == 0.48
    # Only the progress moved: held for a minute
    await run(db_session, redis, senders, start + timedelta(seconds=30))
    assert len(live_activity.sent) == 1
    await run(db_session, redis, senders, start + MIN)
    assert len(live_activity.sent) == 2
    assert live_activity.sent[-1].content_state["progress"] == 0.5
    # A new delay goes out at once
    await set_live(redis, location(delay=2, passed=2))
    await run(db_session, redis, senders, start + MIN + timedelta(seconds=20))
    assert len(live_activity.sent) == 3
    assert live_activity.sent[-1].content_state["delayMin"] == 2


async def test_live_activity_kill_switch(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    expo: FakeExpo,
    live_activity: FakeLiveActivity,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "LIVE_ACTIVITY_PUSH_ENABLED", False)
    device = await add_device(db_session)
    await add_token(db_session, device)
    follow = await follow_trip(db_session, device)
    await add_token(db_session, device, LA_TOKEN, follow)
    await set_live(redis, location(delay=12, passed=-1))

    await run(db_session, redis, senders)
    # The alert goes out as a notification instead
    assert live_activity.sent == []
    assert len(expo.sent) == 1


def observation(**kw: Any) -> Observation:
    values: dict[str, Any] = {
        "trip_id": "1:s70",
        "service_date": TODAY,
        "context": TrainContext("S70", "Kelenföld", "14:32"),
        "delay_min": 3,
        "platform": None,
        "scheduled_platform": None,
        "departed": False,
        "finished": False,
        "next_stop": "Kelenföld",
        "next_stop_at": 1_800_000_000,
    }
    return Observation(**{**values, **kw})


def test_live_activity_platform_guess_and_relevance() -> None:
    # Only the usual platform: shown as a guess
    content = live_activity_content(observation(scheduled_platform="4"))
    assert (content["platform"], content["platformSure"]) == ("4", False)
    content = live_activity_content(observation(platform="5", scheduled_platform="4"))
    assert (content["platform"], content["platformSure"]) == ("5", True)
    # Negative delays show as on time
    assert live_activity_content(observation(delay_min=-2))["delayMin"] == 0

    soon = observation(next_stop_at=1_800_000_000)
    assert live_activity_relevance(soon, 1_800_000_000 - 10 * 60) == 90.0
    assert live_activity_relevance(soon, 1_800_000_000 - 5 * 3600) == 1.0
    assert live_activity_relevance(observation(departed=True), 0) == 100.0


def test_live_activity_due() -> None:
    a = {"delayMin": 1, "nextStop": "Érd", "progress": 0.1}
    assert live_activity_due(a, None, None, 100)
    assert not live_activity_due(a, a, 0, 1000)
    assert not live_activity_due({**a, "progress": 0.2}, a, 50, 100)
    assert live_activity_due({**a, "progress": 0.2}, a, 40, 100)
    assert live_activity_due({**a, "delayMin": 2}, a, 99, 100)


async def test_one_failing_follow_does_not_stop_others(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    expo: FakeExpo,
) -> None:
    broken = await add_device(db_session)
    await add_token(db_session, broken, "ExponentPushToken[broken]")
    # Follows are processed in id order: the broken one first
    await follow_trip(db_session, broken, id=uuid.UUID(int=1))
    fine = await add_device(db_session)
    await add_token(db_session, fine)
    await follow_trip(db_session, fine, id=uuid.UUID(int=2))
    expo.raise_for.add("ExponentPushToken[broken]")
    await set_live(redis, location(delay=12, passed=-1))

    stats = await run(db_session, redis, senders)
    assert stats.errors == 1
    assert [m.token for m in expo.sent] == [EXPO_TOKEN]


async def test_concurrent_run_is_skipped(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
) -> None:
    await redis.set(push_alerts.add_key("push:evaluate-lock"), "other")
    stats = await run(db_session, redis, senders)
    assert stats.skipped_locked


async def test_state_rows_are_keyed_by_follow_and_service_date(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
) -> None:
    device = await add_device(db_session)
    await add_token(db_session, device)
    follow = await follow_trip(db_session, device)
    await set_live(redis, location(delay=12, passed=-1))
    await run(db_session, redis, senders)
    rows = (
        await db_session.scalars(
            select(NotificationState).where(NotificationState.follow_id == follow.id)
        )
    ).all()
    assert [(r.service_date, r.trip_id) for r in rows] == [
        (date(2026, 10, 27), "1:s70")
    ]


# --- Usual platform of commutes ---


async def seed_platforms(session: AsyncSession, platforms: list[str]) -> None:
    """One passage of train 5123 at Kelenföld per past day, on these platforms."""
    rows: list[dict[str, Any]] = []
    for i, platform in enumerate(platforms):
        rows.append(
            {
                "service_date": TODAY - timedelta(days=i + 1),
                "trip_gtfs_id": f"1:s70-{i}",
                "stop_sequence": 1,
                "trip_short_name": "5123 személyvonat",
                "route_short_name": "S70",
                "stop_id": f"1:{KELENFOLD}_{platform}",
                "station_id": KELENFOLD,
                "scheduled_arrival_s": 14 * 3600 + 32 * 60,
                "scheduled_departure_s": 14 * 3600 + 32 * 60,
                "delay_s": 0,
                "platform": platform,
                "observed_at": NOW - timedelta(days=i + 1),
            }
        )
    stops = {
        r["stop_id"]: {
            "gtfs_id": r["stop_id"],
            "station_id": KELENFOLD,
            "name": "Kelenföld",
            "lat": 47.0,
            "lon": 19.0,
        }
        for r in rows
    }
    await session.execute(
        insert(Stop).values(list(stops.values())).on_conflict_do_nothing()
    )
    for d in {r["service_date"] for r in rows}:
        await ensure_partition(session, d)
    await session.execute(insert(StopDelayObservation).values(rows))
    await session.flush()


@pytest.fixture
def _history_today(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(insights, "today", lambda: TODAY)


@pytest.mark.usefixtures("_history_today")
async def test_commute_platform_change_against_usual_platform(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    expo: FakeExpo,
) -> None:
    # 9 of 10 recent passages on platform 4
    await seed_platforms(db_session, ["4"] * 9 + ["2"])
    device = await add_device(db_session)
    await add_token(db_session, device)
    follow = await add_commute(db_session, device, TUESDAY_ONLY, FEHERVAR)
    await set_live(redis, location(passed=-1, platforms={1: "6"}))

    await run(db_session, redis, senders)
    assert [m.title for m in expo.sent] == ["S70 · új vágány: 6 · Kelenföld 14:32"]
    state = await state_of(db_session, follow)
    assert state is not None
    assert state.last_platform == "6"


@pytest.mark.usefixtures("_history_today")
async def test_commute_on_usual_platform_is_quiet(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    expo: FakeExpo,
) -> None:
    await seed_platforms(db_session, ["4"] * 10)
    device = await add_device(db_session)
    await add_token(db_session, device)
    await add_commute(db_session, device, TUESDAY_ONLY)
    await set_live(redis, location(passed=-1, platforms={1: "4"}))
    await run(db_session, redis, senders)
    assert expo.sent == []


@pytest.mark.usefixtures("_history_today")
async def test_commute_with_unsure_usual_platform_takes_first_sight(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    expo: FakeExpo,
) -> None:
    # 7 of 10 is below the 0.8 confidence needed
    await seed_platforms(db_session, ["4"] * 7 + ["2"] * 3)
    device = await add_device(db_session)
    await add_token(db_session, device)
    follow = await add_commute(db_session, device, TUESDAY_ONLY)
    await set_live(redis, location(passed=-1, platforms={1: "6"}))

    await run(db_session, redis, senders)
    assert expo.sent == []
    state = await state_of(db_session, follow)
    assert state is not None
    assert state.last_platform == "6"


@pytest.mark.usefixtures("_history_today")
async def test_usual_platform_needs_confidence(
    db_session: AsyncSession, redis: fakeredis.FakeAsyncRedis
) -> None:
    await seed_platforms(db_session, ["4"] * 8 + ["2"] * 2)
    assert await usual_platform(db_session, redis, KELENFOLD, "5123") == "4"
    assert await usual_platform(db_session, redis, KELENFOLD, "9999") is None


@pytest.mark.usefixtures("_history_today")
async def test_usual_platform_needs_enough_runs(
    db_session: AsyncSession, redis: fakeredis.FakeAsyncRedis
) -> None:
    # Always platform 4, but only four times: as on the web, not enough
    await seed_platforms(db_session, ["4"] * 4)
    assert await usual_platform(db_session, redis, KELENFOLD, "5123") is None
