import json
from types import SimpleNamespace

import fakeredis
import httpx
import pytest
import respx

from api.services import alerts_service
from tests.upstream import graphql_route, otp_responder

# Moment the alert fixture was captured
CAPTURED_AT = 1793222600


@pytest.fixture
def frozen_now(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    clock = SimpleNamespace(now=CAPTURED_AT)
    monkeypatch.setattr(alerts_service, "time", SimpleNamespace(time=lambda: clock.now))
    return clock


async def test_alerts_are_rail_only(
    client: httpx.AsyncClient, otp: respx.MockRouter, frozen_now: SimpleNamespace
) -> None:
    route = graphql_route(otp).mock(side_effect=otp_responder())

    response = await client.get("/v1/alerts")

    assert response.status_code == 200
    alerts = response.json()
    # The fixture also holds BKK, VBUSZ and regional coach alerts
    assert len(alerts) == 4
    assert all(a["id"].startswith("QWxlcnQ6MT") for a in alerts)  # "Alert:1:"
    assert json.loads(route.calls[0].request.content)["variables"] == {"feeds": ["1"]}

    starts = [a["start"] for a in alerts]
    assert starts == sorted(starts, reverse=True)

    hev = next(
        a
        for a in alerts
        if any(r["mode"] == "SUBURBAN_RAILWAY" for r in a["affectedRoutes"])
    )
    assert hev["header"] is None
    assert hev["affectedTrips"][0]["tripId"].startswith("1:")

    reasons = {a["description"]: a["reason"] for a in alerts}
    assert reasons["Pálya állapota miatti késés"] == {
        "code": "track",
        "label": "Pálya állapota",
    }

    accident = next(a for a in alerts if a["affectedStations"])
    assert accident["affectedRoutes"] == []
    assert {"id": "005512880", "name": "Ózd"} in accident["affectedStations"]
    assert all(s["id"].isdigit() for s in accident["affectedStations"])


async def test_expired_alerts_are_dropped(
    client: httpx.AsyncClient, otp: respx.MockRouter, frozen_now: SimpleNamespace
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder())
    frozen_now.now = CAPTURED_AT + 400  # one track alert ended in between

    response = await client.get("/v1/alerts")

    assert len(response.json()) == 3


async def test_alerts_are_cached(
    client: httpx.AsyncClient,
    otp: respx.MockRouter,
    redis: fakeredis.FakeAsyncRedis,
    frozen_now: SimpleNamespace,
) -> None:
    route = graphql_route(otp).mock(side_effect=otp_responder())

    first = await client.get("/v1/alerts")
    second = await client.get("/v1/alerts")

    assert route.call_count == 1
    assert first.json() == second.json()
    assert 0 < await redis.ttl(alerts_service.alerts_cache_key()) <= 120


async def test_alerts_upstream_timeout_is_502(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    graphql_route(otp).mock(side_effect=httpx.ConnectTimeout("timed out"))

    response = await client.get("/v1/alerts")

    assert response.status_code == 502
    assert response.json() == {"detail": "Upstream timetable service is unavailable"}


def test_alert_with_only_bus_routes_is_not_rail() -> None:
    alert = {
        "feed": "1",
        "entities": [
            {"__typename": "Route", "gtfsId": "BKK:0050", "mode": "BUS"},
        ],
    }

    assert alerts_service.is_rail_alert(alert) is False
