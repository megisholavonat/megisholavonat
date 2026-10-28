import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import fakeredis
import httpx
import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.core import rate_limit
from api.core.config import settings
from api.models.devices import PushToken
from api.services.devices import device_key, run_housekeeping
from api.services.push_alerts import live_activity_key

FROZEN_NOW = 1_800_000_000 - 1_800_000_000 % 3600 + 1800
EXPO = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
LIVE_ACTIVITY = "0123456789abcdef" * 4


@pytest.fixture(autouse=True)
def _frozen_rate_limit_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rate_limit, "time", SimpleNamespace(time=lambda: FROZEN_NOW))


async def register(
    client: httpx.AsyncClient, platform: str = "ios", locale: str = "hu"
) -> dict[str, str]:
    r = await client.post("/v1/devices", json={"platform": platform, "locale": locale})
    assert r.status_code == 201, r.text
    body = r.json()
    return {"Authorization": f"Bearer {body['deviceId']}.{body['token']}"}


def device_id(auth: dict[str, str]) -> uuid.UUID:
    return uuid.UUID(auth["Authorization"].split()[1].split(".")[0])


async def follow(client: httpx.AsyncClient, auth: dict[str, str]) -> str:
    r = await client.post(
        "/v1/follows",
        json={
            "kind": "trip",
            "tripId": "1:s70",
            "serviceDate": datetime.now(UTC).date().isoformat(),
            "tripShortName": "5123",
        },
        headers=auth,
    )
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


async def add_token(
    client: httpx.AsyncClient, auth: dict[str, str], **body: str
) -> httpx.Response:
    return await client.post("/v1/devices/me/push-tokens", json=body, headers=auth)


async def tokens_of(session: AsyncSession, device: uuid.UUID) -> list[PushToken]:
    return list(
        await session.scalars(
            select(PushToken)
            .where(PushToken.device_id == device)
            .execution_options(populate_existing=True)
        )
    )


async def test_register_expo_token(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    auth = await register(client)
    r = await add_token(client, auth, type="expo", token=EXPO)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["type"] == "expo"
    assert body["followId"] is None
    assert "token" not in body
    [token] = await tokens_of(db_session, device_id(auth))
    assert token.token == EXPO
    assert str(token.id) == body["id"]

    # Registering again is harmless
    again = await add_token(client, auth, type="expo", token=EXPO)
    assert again.json()["id"] == body["id"]
    assert len(await tokens_of(db_session, device_id(auth))) == 1


async def test_register_live_activity_token(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    auth = await register(client)
    follow_id = await follow(client, auth)
    r = await add_token(
        client, auth, type="liveactivity", token=LIVE_ACTIVITY, followId=follow_id
    )
    assert r.status_code == 201, r.text
    assert r.json()["followId"] == follow_id


@pytest.mark.parametrize(
    "body",
    [
        {"type": "expo", "token": "not-an-expo-token"},
        {"type": "liveactivity", "token": LIVE_ACTIVITY},
        {"type": "liveactivity", "token": "zz", "followId": str(uuid.uuid4())},
        {"type": "webpush", "token": "x"},
    ],
)
async def test_invalid_tokens_are_rejected(
    client: httpx.AsyncClient, body: dict[str, str]
) -> None:
    auth = await register(client)
    r = await add_token(client, auth, **body)
    assert r.status_code == 422


async def test_no_push_for_web_and_no_live_activity_on_android(
    client: httpx.AsyncClient,
) -> None:
    web = await register(client, "web")
    assert (await add_token(client, web, type="expo", token=EXPO)).status_code == 422
    android = await register(client, "android")
    follow_id = await follow(client, android)
    r = await add_token(
        client, android, type="liveactivity", token=LIVE_ACTIVITY, followId=follow_id
    )
    assert r.status_code == 422


async def test_live_activity_needs_own_follow(client: httpx.AsyncClient) -> None:
    owner = await register(client)
    follow_id = await follow(client, owner)
    other = await register(client)
    r = await add_token(
        client, other, type="liveactivity", token=LIVE_ACTIVITY, followId=follow_id
    )
    assert r.status_code == 404


async def test_token_moves_to_the_registering_device(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    old = await register(client)
    first = await add_token(client, old, type="expo", token=EXPO)
    await db_session.execute(
        update(PushToken)
        .where(PushToken.token == EXPO)
        .values(failure_count=3, last_error="x")
    )
    new = await register(client)
    second = await add_token(client, new, type="expo", token=EXPO)
    assert second.status_code == 201
    assert second.json()["id"] == first.json()["id"]

    assert await tokens_of(db_session, device_id(old)) == []
    [token] = await tokens_of(db_session, device_id(new))
    assert token.failure_count == 0
    assert token.last_error is None


async def test_delete_token(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    auth = await register(client)
    token_id = (await add_token(client, auth, type="expo", token=EXPO)).json()["id"]
    other = await register(client)
    url = f"/v1/devices/me/push-tokens/{token_id}"
    assert (await client.delete(url, headers=other)).status_code == 404
    assert (await client.delete(url, headers=auth)).status_code == 204
    assert (await client.delete(url, headers=auth)).status_code == 404
    assert await tokens_of(db_session, device_id(auth)) == []


async def test_requires_auth(client: httpx.AsyncClient) -> None:
    r = await client.post(
        "/v1/devices/me/push-tokens", json={"type": "expo", "token": EXPO}
    )
    assert r.status_code == 401


async def test_device_erasure_removes_tokens_and_live_activity_state(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
) -> None:
    auth = await register(client)
    follow_id = await follow(client, auth)
    await add_token(client, auth, type="expo", token=EXPO)
    la = await add_token(
        client, auth, type="liveactivity", token=LIVE_ACTIVITY, followId=follow_id
    )
    key = live_activity_key(device_id(auth), uuid.UUID(la.json()["id"]))
    assert key.startswith(device_key(device_id(auth), ""))
    await redis.set(key, "{}")

    assert (await client.delete("/v1/devices/me", headers=auth)).status_code == 204
    assert await tokens_of(db_session, device_id(auth)) == []
    assert not await redis.exists(key)


async def test_follow_deletion_removes_its_live_activity_token(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    auth = await register(client)
    follow_id = await follow(client, auth)
    await add_token(client, auth, type="expo", token=EXPO)
    await add_token(
        client, auth, type="liveactivity", token=LIVE_ACTIVITY, followId=follow_id
    )
    r = await client.delete(f"/v1/follows/{follow_id}", headers=auth)
    assert r.status_code == 204
    assert [t.type for t in await tokens_of(db_session, device_id(auth))] == ["expo"]


async def test_housekeeping_drops_failing_and_old_live_activity_tokens(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
) -> None:
    auth = await register(client)
    follow_id = await follow(client, auth)
    await add_token(client, auth, type="expo", token=EXPO)
    healthy = "ExponentPushToken[healthy]"
    await add_token(client, auth, type="expo", token=healthy)
    await add_token(
        client, auth, type="liveactivity", token=LIVE_ACTIVITY, followId=follow_id
    )
    now = datetime.now(UTC)
    await db_session.execute(
        update(PushToken)
        .where(PushToken.token == EXPO)
        .values(failure_count=settings.PUSH_TOKEN_MAX_FAILURES)
    )
    await db_session.execute(
        update(PushToken)
        .where(PushToken.type == "liveactivity")
        .values(updated_at=now - timedelta(hours=13))
    )

    result = await run_housekeeping(db_session, redis, now.date(), now=now)
    assert result["failingPushTokens"] == 1
    assert result["expiredLiveActivityTokens"] == 1
    assert [t.token for t in await tokens_of(db_session, device_id(auth))] == [healthy]
