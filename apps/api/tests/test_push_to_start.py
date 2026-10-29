"""Push-to-start of Live Activities (iOS 17.2+), with the fake APNs sender."""

import uuid
from datetime import date, datetime, timedelta
from typing import Any

import fakeredis
import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.models.devices import Device, Follow, PushToken
from api.services.push_alerts import Senders, start_backoff_key, start_run
from api.services.push_senders import Outcome, live_activity_payload
from tests.push_fakes import (
    NOW,
    TODAY,
    TUESDAY_ONLY,
    WEDNESDAY_ONLY,
    FakeExpo,
    FakeLiveActivity,
    location,
    set_live,
)
from tests.test_push_alerts import (
    LA_TOKEN,
    MIN,
    add_commute,
    add_device,
    add_token,
    budapest,
    follow_trip,
    run,
)
from tests.test_push_tokens import add_token as post_token
from tests.test_push_tokens import device_id, register, tokens_of

START_TOKEN = "cd" * 32
# Kelenföld 14:32 -> Székesfehérvár 15:30 (S70_STOPS); NOW is 14:00
SETUP: dict[str, Any] = {
    "badge": "S70",
    "title": "5123 → Székesfehérvár",
    "fromName": "Kelenföld",
    "toName": "Székesfehérvár",
    "departureS": 14 * 3600 + 32 * 60,
    "arrivalS": 15 * 3600 + 30 * 60,
    "platform": "3",
}
DEPARTURE = budapest("2026-10-27T14:32")


@pytest.fixture
def expo() -> FakeExpo:
    return FakeExpo()


@pytest.fixture
def live_activity() -> FakeLiveActivity:
    return FakeLiveActivity()


@pytest.fixture
def senders(expo: FakeExpo, live_activity: FakeLiveActivity) -> Senders:
    return Senders(expo=expo, live_activity=live_activity)


async def add_start_token(
    session: AsyncSession, device: Device, token: str = START_TOKEN
) -> PushToken:
    push_token = PushToken(
        id=uuid.uuid4(), device_id=device.id, type="liveactivity_start", token=token
    )
    session.add(push_token)
    await session.flush()
    return push_token


async def setup_trip(
    session: AsyncSession, setup: dict[str, Any] | None = SETUP
) -> tuple[Device, Follow]:
    device = await add_device(session)
    await add_start_token(session, device)
    follow = await follow_trip(session, device, live_activity=setup)
    return device, follow


def starts(live_activity: FakeLiveActivity) -> list[Any]:
    return [m for m in live_activity.sent if m.event == "start"]


async def test_start_is_sent_once_in_the_window(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    live_activity: FakeLiveActivity,
) -> None:
    _, follow = await setup_trip(db_session)

    # 41 minutes before: too early
    await run(db_session, redis, senders, NOW - 9 * MIN)
    assert starts(live_activity) == []

    stats = await run(db_session, redis, senders)
    assert stats.live_activity_starts == 1
    [start] = starts(live_activity)
    assert start.token == START_TOKEN
    assert start.attributes_type == "TrainActivityAttributes"
    assert start.attributes == {
        "followId": str(follow.id),
        "badge": "S70",
        "title": "5123 → Székesfehérvár",
        "from": "Kelenföld",
        "to": "Székesfehérvár",
        "url": f"megisholavonat://followed/{follow.id}",
    }
    # Not live yet: the timetable
    assert start.content_state == {
        "delayMin": None,
        "nextStop": "Kelenföld",
        "nextStopAt": DEPARTURE,
        "platform": "3",
        "platformSure": True,
        "eta": budapest("2026-10-27T15:30"),
        "progress": 0.0,
        "departed": False,
    }
    assert start.alert == ("S70 · Kelenföld 14:32", "32 perc múlva indul")
    assert start.stale_date == DEPARTURE + 10 * 60

    # What APNs gets
    aps = live_activity_payload(start)["aps"]
    assert aps["event"] == "start"
    assert aps["attributes-type"] == "TrainActivityAttributes"
    assert aps["attributes"]["followId"] == str(follow.id)
    assert aps["alert"] == {
        "title": "S70 · Kelenföld 14:32",
        "body": "32 perc múlva indul",
    }
    assert "sound" not in aps

    # Once per run
    await run(db_session, redis, senders, NOW + MIN)
    await run(db_session, redis, senders, NOW + 20 * MIN)
    assert len(starts(live_activity)) == 1


async def test_start_uses_the_live_train(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    live_activity: FakeLiveActivity,
) -> None:
    await setup_trip(db_session)
    await set_live(redis, location(delay=6, passed=-1))

    await run(db_session, redis, senders)
    [start] = starts(live_activity)
    assert start.content_state["delayMin"] == 6
    assert start.content_state["nextStopAt"] == budapest("2026-10-27T14:38")


async def test_no_start_with_an_activity_token(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    live_activity: FakeLiveActivity,
) -> None:
    device, follow = await setup_trip(db_session)
    # The app started it (or an earlier start) and registered its token
    await add_token(db_session, device, LA_TOKEN, follow)

    await run(db_session, redis, senders)
    assert starts(live_activity) == []


@pytest.mark.parametrize(
    "disable",
    ["LIVE_ACTIVITY_PUSH_ENABLED", "LIVE_ACTIVITY_PUSH_TO_START_ENABLED", "toggle"],
)
async def test_no_start_when_disabled(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    live_activity: FakeLiveActivity,
    monkeypatch: pytest.MonkeyPatch,
    disable: str,
) -> None:
    if disable == "toggle":
        await setup_trip(db_session, setup=None)
    else:
        monkeypatch.setattr(settings, disable, False)
        await setup_trip(db_session)

    await run(db_session, redis, senders)
    assert starts(live_activity) == []


async def test_no_start_outside_the_window(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    live_activity: FakeLiveActivity,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await setup_trip(db_session)
    # Departed already
    await run(db_session, redis, senders, NOW + 32 * MIN)
    assert starts(live_activity) == []
    # A shorter window: 14:00 is too early for 14:32
    monkeypatch.setattr(settings, "LIVE_ACTIVITY_START_WINDOW_MIN", 30)
    await run(db_session, redis, senders)
    assert starts(live_activity) == []
    await run(db_session, redis, senders, NOW + 2 * MIN)
    assert len(starts(live_activity)) == 1


async def test_no_start_without_a_start_token(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    live_activity: FakeLiveActivity,
) -> None:
    device = await add_device(db_session)
    await follow_trip(db_session, device, live_activity=SETUP)
    await run(db_session, redis, senders)
    assert starts(live_activity) == []


async def test_commute_starts_on_its_weekdays(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    live_activity: FakeLiveActivity,
) -> None:
    device = await add_device(db_session, locale="en-GB")
    await add_start_token(db_session, device)
    tuesday = await add_commute(db_session, device, TUESDAY_ONLY)
    tuesday.live_activity = SETUP
    wednesday = await add_commute(db_session, device, WEDNESDAY_ONLY)
    wednesday.live_activity = SETUP
    await db_session.flush()

    await run(db_session, redis, senders)
    [start] = starts(live_activity)
    assert start.attributes is not None
    assert start.attributes["followId"] == str(tuesday.id)
    # A commute's platform is the one it used when followed: a guess
    assert start.content_state["platformSure"] is False
    assert start.alert == ("S70 · Kelenföld 14:32", "Leaves in 32 min")


def test_start_run_past_midnight() -> None:
    # Wednesdays at 00:10, on Tuesday's service day
    setup = {**SETUP, "departureS": 24 * 3600 + 10 * 60, "arrivalS": None}
    late = datetime.fromisoformat("2026-10-27T23:40:00+01:00")
    found = start_run("commute", None, WEDNESDAY_ONLY, setup, late, 40 * 60)
    assert found is not None
    assert found.service_date == TODAY
    assert found.departure == budapest("2026-10-28T00:10")
    assert found.arrival is None
    assert start_run("commute", None, TUESDAY_ONLY, setup, late, 40 * 60) is None
    # A trip only on its service date
    assert start_run("trip", date(2026, 10, 26), None, SETUP, NOW, 40 * 60) is None
    assert start_run("trip", TODAY, None, SETUP, NOW, 40 * 60) is not None


async def test_throttled_start_is_retried_after_a_pause(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    live_activity: FakeLiveActivity,
) -> None:
    await setup_trip(db_session)
    live_activity.outcomes[START_TOKEN] = Outcome.THROTTLED
    live_activity.errors[START_TOKEN] = "TooManyProviderTokenUpdates"

    await run(db_session, redis, senders)
    assert len(starts(live_activity)) == 1
    # Every start pauses for a while
    assert await redis.exists(start_backoff_key())
    await run(db_session, redis, senders, NOW + MIN)
    assert len(starts(live_activity)) == 1

    # The run's start waits out the pause too, then is sent again
    [key] = await redis.keys("*liveactivity-start:*")
    assert 0 < await redis.ttl(key) <= 5 * 60
    await redis.delete(start_backoff_key(), key)
    del live_activity.outcomes[START_TOKEN]
    await run(db_session, redis, senders, NOW + 6 * MIN)
    assert len(starts(live_activity)) == 2


async def test_failed_start_is_retried(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    live_activity: FakeLiveActivity,
) -> None:
    await setup_trip(db_session)
    live_activity.outcomes[START_TOKEN] = Outcome.FAILED

    await run(db_session, redis, senders)
    [key] = await redis.keys("*liveactivity-start:*")
    assert 0 < await redis.ttl(key) <= 60


async def test_dead_start_token_is_dropped(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    live_activity: FakeLiveActivity,
) -> None:
    device = await add_device(db_session)
    token = await add_start_token(db_session, device)
    await follow_trip(db_session, device, live_activity=SETUP)
    live_activity.outcomes[START_TOKEN] = Outcome.UNREGISTERED

    await run(db_session, redis, senders)
    assert await db_session.get(PushToken, token.id, populate_existing=True) is None


# --- Registering the token ---


async def test_start_token_rotates(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    auth = await register(client)
    first, second = "0a" * 32, "0b" * 32
    r = await post_token(client, auth, type="liveactivity_start", token=first)
    assert r.status_code == 201, r.text
    assert r.json()["type"] == "liveactivity_start"
    assert r.json()["followId"] is None
    await post_token(client, auth, type="expo", token="ExponentPushToken[x]")
    # A new token replaces the old one; other tokens stay
    r = await post_token(client, auth, type="liveactivity_start", token=second)
    assert r.status_code == 201, r.text
    tokens = await tokens_of(db_session, device_id(auth))
    assert sorted((t.type, t.token) for t in tokens) == [
        ("expo", "ExponentPushToken[x]"),
        ("liveactivity_start", second),
    ]


async def test_start_token_is_ios_only(client: httpx.AsyncClient) -> None:
    auth = await register(client, platform="android")
    r = await post_token(client, auth, type="liveactivity_start", token="0a" * 32)
    assert r.status_code == 422


async def test_follow_live_activity_setup(client: httpx.AsyncClient) -> None:
    auth = await register(client)
    r = await client.post(
        "/v1/follows",
        headers=auth,
        json={
            "kind": "commute",
            "tripShortName": "5123",
            "weekdays": [2],
            "fromStationId": "005501024",
            "liveActivity": SETUP,
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["liveActivity"] == SETUP
    r = await client.patch(
        f"/v1/follows/{body['id']}", headers=auth, json={"liveActivity": None}
    )
    assert r.status_code == 200, r.text
    assert r.json()["liveActivity"] is None
    r = await client.post(
        "/v1/follows",
        headers=auth,
        json={
            "kind": "trip",
            "tripId": "1:x",
            "serviceDate": datetime.now().date().isoformat(),
            "tripShortName": "5123",
            "liveActivity": {**SETUP, "departureS": -1},
        },
    )
    assert r.status_code == 422


async def test_start_after_rotation_goes_to_the_new_token(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    senders: Senders,
    live_activity: FakeLiveActivity,
) -> None:
    device, _ = await setup_trip(db_session)
    # As the router does on rotation
    for t in await tokens_of(db_session, device.id):
        if t.type == "liveactivity_start":
            await db_session.delete(t)
    await add_start_token(db_session, device, "ef" * 32)

    await run(db_session, redis, senders, NOW + timedelta(seconds=1))
    assert [m.token for m in starts(live_activity)] == ["ef" * 32]
