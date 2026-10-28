import hashlib
import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace

import fakeredis
import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.core import rate_limit
from api.core.config import settings
from api.core.db import get_session
from api.core.redis import get_redis
from api.main import create_app
from api.models.devices import Device, Follow, NotificationState
from api.services.devices import device_key, run_housekeeping

# Middle of an hour, so a fixed window never rolls over during a test
FROZEN_NOW = 1_800_000_000 - 1_800_000_000 % 3600 + 1800


@pytest.fixture(autouse=True)
def _frozen_rate_limit_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rate_limit, "time", SimpleNamespace(time=lambda: FROZEN_NOW))


async def register(
    client: httpx.AsyncClient, platform: str = "web", **headers: str
) -> dict[str, str]:
    r = await client.post(
        "/v1/devices", json={"platform": platform, "locale": "hu"}, headers=headers
    )
    assert r.status_code == 201, r.text
    body = r.json()
    return {"Authorization": f"Bearer {body['deviceId']}.{body['token']}"}


# --- Registration and auth ---


async def test_register_returns_id_and_token_and_stores_only_hash(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    r = await client.post("/v1/devices", json={"platform": "ios"})
    assert r.status_code == 201
    body = r.json()
    assert len(body["token"]) >= 43

    device = await db_session.get(Device, uuid.UUID(body["deviceId"]))
    assert device is not None
    assert device.platform == "ios"
    assert device.token_hash == hashlib.sha256(body["token"].encode()).digest()


async def test_register_rejects_unknown_platform(client: httpx.AsyncClient) -> None:
    r = await client.post("/v1/devices", json={"platform": "symbian"})
    assert r.status_code == 422


async def test_good_token_authenticates(client: httpx.AsyncClient) -> None:
    auth = await register(client)
    r = await client.get("/v1/devices/me", headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert body["platform"] == "web"
    assert body["locale"] == "hu"
    assert auth["Authorization"].startswith(f"Bearer {body['deviceId']}.")


async def test_bad_token_is_rejected(client: httpx.AsyncClient) -> None:
    auth = await register(client)
    device_id = auth["Authorization"].removeprefix("Bearer ").split(".")[0]
    r = await client.get(
        "/v1/devices/me", headers={"Authorization": f"Bearer {device_id}.wrong"}
    )
    assert r.status_code == 401
    assert r.headers["WWW-Authenticate"] == "Bearer"


async def test_unknown_device_is_rejected(client: httpx.AsyncClient) -> None:
    r = await client.get(
        "/v1/devices/me", headers={"Authorization": f"Bearer {uuid.uuid4()}.abc"}
    )
    assert r.status_code == 401


@pytest.mark.parametrize(
    "header",
    [
        None,
        "Bearer",
        "Basic dXNlcjpwYXNz",
        "Bearer no-dot-here",
        "Bearer not-a-uuid.token",
        f"Bearer {uuid.uuid4()}.",
    ],
)
async def test_malformed_header_is_rejected(
    client: httpx.AsyncClient, header: str | None
) -> None:
    headers = {"Authorization": header} if header else {}
    r = await client.get("/v1/devices/me", headers=headers)
    assert r.status_code == 401


async def test_rotated_token_invalidates_old_one(client: httpx.AsyncClient) -> None:
    old = await register(client)
    r = await client.post("/v1/devices/me/rotate-token", headers=old)
    assert r.status_code == 200
    body = r.json()
    new = {"Authorization": f"Bearer {body['deviceId']}.{body['token']}"}
    assert new != old

    assert (await client.get("/v1/devices/me", headers=old)).status_code == 401
    assert (await client.get("/v1/devices/me", headers=new)).status_code == 200


async def test_last_seen_updated_at_most_daily(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    auth = await register(client)
    device_id = uuid.UUID(auth["Authorization"].split()[1].split(".")[0])

    earlier_today = datetime.now(UTC).replace(hour=0, minute=0, second=1)
    await db_session.execute(
        update(Device).where(Device.id == device_id).values(last_seen_at=earlier_today)
    )
    await client.get("/v1/devices/me", headers=auth)
    device = await db_session.get(Device, device_id, populate_existing=True)
    assert device is not None
    assert device.last_seen_at == earlier_today

    yesterday = earlier_today - timedelta(days=1)
    await db_session.execute(
        update(Device).where(Device.id == device_id).values(last_seen_at=yesterday)
    )
    await client.get("/v1/devices/me", headers=auth)
    device = await db_session.get(Device, device_id, populate_existing=True)
    assert device is not None
    assert device.last_seen_at.date() == datetime.now(UTC).date()


def test_bearer_scheme_in_openapi(app: FastAPI) -> None:
    spec = app.openapi()
    assert spec["components"]["securitySchemes"]["DeviceToken"] == {
        "type": "http",
        "scheme": "bearer",
        "description": "`<deviceId>.<token>` as returned by POST /v1/devices",
    }
    assert spec["paths"]["/v1/follows"]["get"]["security"] == [{"DeviceToken": []}]
    assert "security" not in spec["paths"]["/v1/devices"]["post"]


# --- Rate limit ---


async def test_registration_limited_per_ip(client: httpx.AsyncClient) -> None:
    for _ in range(settings.DEVICE_REGISTRATIONS_PER_IP_PER_HOUR):
        await register(client)
    r = await client.post("/v1/devices", json={"platform": "web"})
    assert r.status_code == 429
    assert r.headers["Retry-After"] == "1800"


async def test_registration_limited_globally(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "DEVICE_REGISTRATIONS_PER_HOUR", 2)
    await register(client)
    await register(client)
    r = await client.post("/v1/devices", json={"platform": "web"})
    assert r.status_code == 429
    assert int(r.headers["Retry-After"]) > 0


async def test_rate_limit_window_resets(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "DEVICE_REGISTRATIONS_PER_IP_PER_HOUR", 1)
    await register(client)
    assert (
        await client.post("/v1/devices", json={"platform": "web"})
    ).status_code == 429
    monkeypatch.setattr(
        rate_limit, "time", SimpleNamespace(time=lambda: FROZEN_NOW + 3600)
    )
    await register(client)


def _app_behind(db_session: AsyncSession, redis: fakeredis.FakeAsyncRedis) -> FastAPI:
    app = create_app()
    app.dependency_overrides[get_session] = lambda: db_session
    app.dependency_overrides[get_redis] = lambda: redis
    return app


@pytest.fixture
async def proxied_client(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncGenerator[httpx.AsyncClient]:
    """Requests arrive from 10.0.0.2, an ingress inside the trusted 10.0.0.0/8."""
    monkeypatch.setattr(settings, "TRUSTED_PROXIES", "10.0.0.0/8")
    monkeypatch.setattr(settings, "DEVICE_REGISTRATIONS_PER_IP_PER_HOUR", 1)
    transport = httpx.ASGITransport(
        app=_app_behind(db_session, redis), client=("10.0.0.2", 4000)
    )
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def test_forwarded_for_from_trusted_proxy_separates_clients(
    proxied_client: httpx.AsyncClient,
) -> None:
    await register(proxied_client, **{"X-Forwarded-For": "203.0.113.1"})
    await register(proxied_client, **{"X-Forwarded-For": "203.0.113.2"})
    r = await proxied_client.post(
        "/v1/devices",
        json={"platform": "web"},
        headers={"X-Forwarded-For": "203.0.113.1"},
    )
    assert r.status_code == 429


async def test_spoofed_forwarded_for_entries_are_ignored(
    proxied_client: httpx.AsyncClient,
) -> None:
    # The client prepends a fake address; the proxy appends the real one.
    # Only the rightmost untrusted entry counts.
    await register(proxied_client, **{"X-Forwarded-For": "1.1.1.1, 203.0.113.9"})
    r = await proxied_client.post(
        "/v1/devices",
        json={"platform": "web"},
        headers={"X-Forwarded-For": "8.8.8.8, 203.0.113.9"},
    )
    assert r.status_code == 429


async def test_inner_trusted_proxies_are_skipped(
    proxied_client: httpx.AsyncClient,
) -> None:
    await register(proxied_client, **{"X-Forwarded-For": "203.0.113.9, 10.1.2.3"})
    r = await proxied_client.post(
        "/v1/devices",
        json={"platform": "web"},
        headers={"X-Forwarded-For": "203.0.113.9"},
    )
    assert r.status_code == 429


async def test_forwarded_for_from_untrusted_peer_is_ignored(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "TRUSTED_PROXIES", "10.0.0.0/8")
    monkeypatch.setattr(settings, "DEVICE_REGISTRATIONS_PER_IP_PER_HOUR", 1)
    transport = httpx.ASGITransport(
        app=_app_behind(db_session, redis), client=("198.51.100.7", 4000)
    )
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        await register(c, **{"X-Forwarded-For": "203.0.113.1"})
        r = await c.post(
            "/v1/devices",
            json={"platform": "web"},
            headers={"X-Forwarded-For": "203.0.113.2"},
        )
    assert r.status_code == 429


async def test_forwarded_for_ignored_by_default(client: httpx.AsyncClient) -> None:
    assert settings.TRUSTED_PROXIES == ""
    for i in range(settings.DEVICE_REGISTRATIONS_PER_IP_PER_HOUR):
        await register(client, **{"X-Forwarded-For": f"203.0.113.{i}"})
    r = await client.post(
        "/v1/devices",
        json={"platform": "web"},
        headers={"X-Forwarded-For": "203.0.113.200"},
    )
    assert r.status_code == 429


async def _client_from(
    peer: str,
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> httpx.AsyncClient:
    """Behind 10.0.0.0/8 with CF-Connecting-IP enabled, connecting from `peer`."""
    monkeypatch.setattr(settings, "TRUSTED_PROXIES", "10.0.0.0/8")
    monkeypatch.setattr(settings, "CLIENT_IP_HEADER", "CF-Connecting-IP")
    monkeypatch.setattr(settings, "DEVICE_REGISTRATIONS_PER_IP_PER_HOUR", 1)
    transport = httpx.ASGITransport(
        app=_app_behind(db_session, redis), client=(peer, 4000)
    )
    return httpx.AsyncClient(transport=transport, base_url="http://test")


async def test_client_ip_header_from_trusted_peer_separates_clients(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # X-Forwarded-For carries only the edge's address, as Traefik sends it
    # when it does not trust Cloudflare
    edge = {"X-Forwarded-For": "162.158.1.1"}
    async with await _client_from("10.42.0.5", db_session, redis, monkeypatch) as c:
        await register(c, **edge, **{"CF-Connecting-IP": "203.0.113.1"})
        await register(c, **edge, **{"CF-Connecting-IP": "203.0.113.2"})
        r = await c.post(
            "/v1/devices",
            json={"platform": "web"},
            headers={**edge, "CF-Connecting-IP": "203.0.113.1"},
        )
    assert r.status_code == 429


async def test_client_ip_header_keeps_ipv6_bucketing(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with await _client_from("10.42.0.5", db_session, redis, monkeypatch) as c:
        await register(c, **{"CF-Connecting-IP": "2001:db8:1:2::1"})
        r = await c.post(
            "/v1/devices",
            json={"platform": "web"},
            headers={"CF-Connecting-IP": "2001:db8:1:2::ffff"},
        )
    assert r.status_code == 429


async def test_client_ip_header_from_untrusted_peer_is_ignored(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with await _client_from("198.51.100.7", db_session, redis, monkeypatch) as c:
        await register(c, **{"CF-Connecting-IP": "203.0.113.1"})
        r = await c.post(
            "/v1/devices",
            json={"platform": "web"},
            headers={"CF-Connecting-IP": "203.0.113.2"},
        )
    assert r.status_code == 429


async def test_invalid_client_ip_header_is_ignored(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Falls back to the X-Forwarded-For client, which is the same both times
    xff = {"X-Forwarded-For": "203.0.113.9"}
    async with await _client_from("10.42.0.5", db_session, redis, monkeypatch) as c:
        await register(c, **xff, **{"CF-Connecting-IP": "not-an-ip"})
        r = await c.post(
            "/v1/devices",
            json={"platform": "web"},
            headers={**xff, "CF-Connecting-IP": "203.0.113.1, 203.0.113.2"},
        )
    assert r.status_code == 429


async def test_without_client_ip_header_falls_back_to_forwarded_for(
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with await _client_from("10.42.0.5", db_session, redis, monkeypatch) as c:
        await register(c, **{"X-Forwarded-For": "203.0.113.1"})
        await register(c, **{"X-Forwarded-For": "203.0.113.2"})
        r = await c.post(
            "/v1/devices",
            json={"platform": "web"},
            headers={"X-Forwarded-For": "203.0.113.1"},
        )
    assert r.status_code == 429


@pytest.mark.parametrize(
    ("ip", "bucket"),
    [
        ("203.0.113.5", "203.0.113.5"),
        ("2001:db8:1:2:3:4:5:6", "2001:db8:1:2::/64"),
        ("::ffff:203.0.113.5", "203.0.113.5"),
        ("unknown", "unknown"),
    ],
)
def test_rate_limit_bucket(ip: str, bucket: str) -> None:
    assert rate_limit.rate_limit_bucket(ip) == bucket


def test_invalid_trusted_proxies_rejected() -> None:
    with pytest.raises(ValueError, match="does not appear to be"):
        type(settings)(TRUSTED_PROXIES="10.0.0.0/8, not-an-ip")


# --- GDPR erasure ---


async def test_delete_device_erases_everything(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
) -> None:
    auth = await register(client)
    other = await register(client)
    device_id = uuid.UUID(auth["Authorization"].split()[1].split(".")[0])

    r = await client.post(
        "/v1/follows",
        headers=auth,
        json={
            "kind": "commute",
            "tripShortName": "559",
            "weekdays": [1, 2, 3, 4, 5],
            "fromStationId": "005501024",
        },
    )
    assert r.status_code == 201
    follow_id = uuid.UUID(r.json()["id"])
    db_session.add(
        NotificationState(
            follow_id=follow_id, service_date=date(2026, 10, 28), last_delay_min=7
        )
    )
    await db_session.flush()
    await redis.set(device_key(device_id, "anything"), "1")
    await redis.set("unrelated", "1")
    await client.post(
        "/v1/follows",
        headers=other,
        json={
            "kind": "trip",
            "tripId": "1:1",
            "serviceDate": date.today().isoformat(),
            "tripShortName": "559",
        },
    )

    r = await client.delete("/v1/devices/me", headers=auth)
    assert r.status_code == 204

    assert (await client.get("/v1/devices/me", headers=auth)).status_code == 401
    assert await db_session.get(Device, device_id) is None
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(Follow)
            .where(Follow.device_id == device_id)
        )
        == 0
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(NotificationState)
            .where(NotificationState.follow_id == follow_id)
        )
        == 0
    )
    assert not await redis.exists(device_key(device_id, "anything"))
    assert await redis.exists("unrelated")
    # Other devices are untouched
    assert len((await client.get("/v1/follows", headers=other)).json()) == 1


# --- Housekeeping ---


async def test_housekeeping(
    db_session: AsyncSession, redis: fakeredis.FakeAsyncRedis
) -> None:
    today = date(2026, 10, 28)
    now = datetime(2026, 10, 28, 3, 45, tzinfo=UTC)

    active = Device(id=uuid.uuid4(), token_hash=b"x", platform="web", last_seen_at=now)
    idle = Device(
        id=uuid.uuid4(),
        token_hash=b"y",
        platform="android",
        last_seen_at=now - timedelta(days=181),
    )
    almost_idle = Device(
        id=uuid.uuid4(),
        token_hash=b"z",
        platform="ios",
        last_seen_at=now - timedelta(days=179),
    )
    db_session.add_all([active, idle, almost_idle])
    await db_session.flush()

    def trip(service_date: date) -> Follow:
        return Follow(
            id=uuid.uuid4(),
            device_id=active.id,
            kind="trip",
            trip_short_name="559",
            trip_id=f"1:{service_date}",
            service_date=service_date,
        )

    expired = trip(today - timedelta(days=2))
    kept_yesterday = trip(today - timedelta(days=1))
    kept_today = trip(today)
    commute = Follow(
        id=uuid.uuid4(),
        device_id=active.id,
        kind="commute",
        trip_short_name="559",
        weekdays=0b11111,
        from_station_id="005501024",
    )
    idle_follow = Follow(
        id=uuid.uuid4(),
        device_id=idle.id,
        kind="commute",
        trip_short_name="1",
        weekdays=1,
        from_station_id="005501024",
    )
    db_session.add_all([expired, kept_yesterday, kept_today, commute, idle_follow])
    await db_session.flush()
    await redis.set(device_key(idle.id, "x"), "1")
    await redis.set(device_key(active.id, "x"), "1")

    result = await run_housekeeping(db_session, redis, today, now=now)
    assert result == {"expiredTripFollows": 1, "idleDevices": 1}

    remaining = set(
        await db_session.scalars(select(Follow.id).where(Follow.device_id == active.id))
    )
    assert remaining == {kept_yesterday.id, kept_today.id, commute.id}
    assert await db_session.get(Device, idle.id, populate_existing=True) is None
    assert (
        await db_session.scalar(
            select(func.count()).select_from(Follow).where(Follow.id == idle_follow.id)
        )
        == 0
    )
    assert await db_session.get(Device, almost_idle.id) is not None
    assert not await redis.exists(device_key(idle.id, "x"))
    assert await redis.exists(device_key(active.id, "x"))
