import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

import fakeredis
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.devices import Device, Follow, NotificationState, PushToken
from api.services import push_alerts
from api.services.push_alerts import (
    AlertState,
    Observation,
    Senders,
    TrainAhead,
    check_receipts,
    decide,
    evaluate_alerts,
    find_train_ahead,
    platform_of_stop,
    receipts_key,
    train_label,
)
from api.services.push_copy import Alert, AlertKind, TrainContext, lang_for, render
from api.services.push_senders import Outcome, SendResult
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


def test_train_label_and_platform_of_stop() -> None:
    assert (
        train_label({"route": {"shortName": "S70"}, "tripShortName": "5123"}) == "S70"
    )
    assert (
        train_label({"route": {"shortName": "IC"}, "tripShortName": "559 AGRIA"})
        == "IC 559"
    )
    assert platform_of_stop("1:005501024_14") == "14"
    assert platform_of_stop("1:005505876_5b") == "5b"
    assert platform_of_stop("1:005501024") is None


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
    assert update.content_state["delayMin"] == 12
    assert update.content_state["platform"] == "3"
    assert update.content_state["nextStop"] == "Kelenföld"
    # 15:30 + 12 minutes in Budapest
    assert update.content_state["eta"] == int(
        datetime.fromisoformat("2026-10-27T15:42:00+01:00").timestamp()
    )

    # Same content: no update; moved on: silent update
    await run(db_session, redis, senders, NOW + MIN)
    assert len(live_activity.sent) == 1
    await set_live(redis, location(delay=13, passed=1))
    await run(db_session, redis, senders, NOW + 2 * MIN)
    assert live_activity.sent[-1].alert is None
    assert live_activity.sent[-1].content_state["nextStop"] == "Érd"

    # Past the alighting station: end, and the token is gone
    await set_live(redis, location(delay=13, passed=3))
    await run(db_session, redis, senders, NOW + 60 * MIN)
    assert live_activity.sent[-1].event == "end"
    assert await db_session.get(PushToken, la.id, populate_existing=True) is None
    assert expo.sent == []


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
