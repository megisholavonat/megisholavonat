from datetime import datetime, timedelta
from typing import Any

import httpx
import pytest

from api.routers.follows import MAX_FOLLOWS_PER_DEVICE
from api.util.time import BUDAPEST_TZ
from tests.test_devices import register

TODAY = datetime.now(BUDAPEST_TZ).date()


def trip_body(**overrides: Any) -> dict[str, Any]:
    return {
        "kind": "trip",
        "tripId": "1:32737794",
        "serviceDate": TODAY.isoformat(),
        "tripShortName": "559 AGRIA InterRégió",
        "fromStopId": "1:005512401_1",
        **overrides,
    }


def commute_body(**overrides: Any) -> dict[str, Any]:
    return {
        "kind": "commute",
        "tripShortName": "559",
        "weekdays": [5, 1, 2, 3, 4, 1],
        "fromStationId": "005512401",
        "toStationId": "005501016",
        "label": "Munkába",
        **overrides,
    }


@pytest.fixture
async def auth(client: httpx.AsyncClient) -> dict[str, str]:
    return await register(client)


async def test_create_and_list_trip_follow(
    client: httpx.AsyncClient, auth: dict[str, str]
) -> None:
    r = await client.post("/v1/follows", headers=auth, json=trip_body())
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["kind"] == "trip"
    assert body["tripId"] == "1:32737794"
    assert body["toStopId"] is None
    # Defaults: "on time" is at most 5 minutes late
    assert body["alertsEnabled"] is True
    assert body["delayThresholdMin"] == 5
    assert body["notifyPlatformChange"] is True

    listed = (await client.get("/v1/follows", headers=auth)).json()
    assert listed == [body]


async def test_create_commute_follow_normalizes_weekdays(
    client: httpx.AsyncClient, auth: dict[str, str]
) -> None:
    r = await client.post(
        "/v1/follows", headers=auth, json=commute_body(delayThresholdMin=10)
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["weekdays"] == [1, 2, 3, 4, 5]
    assert body["fromStationId"] == "005512401"
    assert body["delayThresholdMin"] == 10
    assert body["label"] == "Munkába"


async def test_follows_require_auth(client: httpx.AsyncClient) -> None:
    assert (await client.get("/v1/follows")).status_code == 401
    r = await client.post("/v1/follows", json=trip_body())
    assert r.status_code == 401


@pytest.mark.parametrize(
    "overrides",
    [
        {"weekdays": []},
        {"weekdays": [0]},
        {"weekdays": [8]},
        {"weekdays": None},
        {"fromStationId": None},
        {"fromStationId": ""},
        {"fromStationId": "Budapest-Keleti"},
        {"toStationId": "1:005501016"},
        {"tripShortName": "   "},
        {"delayThresholdMin": -1},
        {"delayThresholdMin": 241},
    ],
)
async def test_commute_validation(
    client: httpx.AsyncClient, auth: dict[str, str], overrides: dict[str, Any]
) -> None:
    r = await client.post("/v1/follows", headers=auth, json=commute_body(**overrides))
    assert r.status_code == 422, r.text


async def test_commute_requires_boarding_station(
    client: httpx.AsyncClient, auth: dict[str, str]
) -> None:
    body = commute_body()
    del body["fromStationId"]
    r = await client.post("/v1/follows", headers=auth, json=body)
    assert r.status_code == 422
    assert r.json()["detail"][0]["loc"][-1] == "fromStationId"


@pytest.mark.parametrize(
    "overrides",
    [
        {"tripId": ""},
        {"serviceDate": "tomorrow"},
        {"serviceDate": (TODAY - timedelta(days=2)).isoformat()},
        {"kind": "route"},
    ],
)
async def test_trip_validation(
    client: httpx.AsyncClient, auth: dict[str, str], overrides: dict[str, Any]
) -> None:
    r = await client.post("/v1/follows", headers=auth, json=trip_body(**overrides))
    assert r.status_code == 422, r.text


async def test_duplicate_trip_follow_conflicts(
    client: httpx.AsyncClient, auth: dict[str, str]
) -> None:
    assert (
        await client.post("/v1/follows", headers=auth, json=trip_body())
    ).status_code == 201
    r = await client.post("/v1/follows", headers=auth, json=trip_body())
    assert r.status_code == 409
    # Still usable after the failed insert
    assert len((await client.get("/v1/follows", headers=auth)).json()) == 1


async def test_follow_cap(client: httpx.AsyncClient, auth: dict[str, str]) -> None:
    for i in range(MAX_FOLLOWS_PER_DEVICE):
        r = await client.post(
            "/v1/follows", headers=auth, json=trip_body(tripId=f"1:{i}")
        )
        assert r.status_code == 201
    r = await client.post("/v1/follows", headers=auth, json=commute_body())
    assert r.status_code == 409
    assert "50" in r.json()["detail"]

    # The cap is per device
    other = await register(client)
    r = await client.post("/v1/follows", headers=other, json=commute_body())
    assert r.status_code == 201

    # Freeing a slot allows a new follow
    first = (await client.get("/v1/follows", headers=auth)).json()[0]
    await client.delete(f"/v1/follows/{first['id']}", headers=auth)
    r = await client.post("/v1/follows", headers=auth, json=commute_body())
    assert r.status_code == 201


async def test_other_devices_follow_is_not_found(
    client: httpx.AsyncClient, auth: dict[str, str]
) -> None:
    other = await register(client)
    follow = (
        await client.post("/v1/follows", headers=other, json=commute_body())
    ).json()
    url = f"/v1/follows/{follow['id']}"

    assert (await client.patch(url, headers=auth, json={})).status_code == 404
    assert (await client.delete(url, headers=auth)).status_code == 404
    assert (await client.get("/v1/follows", headers=auth)).json() == []
    # Untouched for its owner
    assert (await client.get("/v1/follows", headers=other)).json() == [follow]


async def test_missing_follow_is_not_found(
    client: httpx.AsyncClient, auth: dict[str, str]
) -> None:
    r = await client.delete(
        "/v1/follows/00000000-0000-0000-0000-000000000000", headers=auth
    )
    assert r.status_code == 404


async def test_patch_commute(client: httpx.AsyncClient, auth: dict[str, str]) -> None:
    follow = (
        await client.post("/v1/follows", headers=auth, json=commute_body())
    ).json()
    r = await client.patch(
        f"/v1/follows/{follow['id']}",
        headers=auth,
        json={
            "weekdays": [6, 7],
            "toStationId": None,
            "alertsEnabled": False,
            "delayThresholdMin": 15,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["weekdays"] == [6, 7]
    assert body["toStationId"] is None
    assert body["label"] == "Munkába"  # not sent, so unchanged
    assert body["alertsEnabled"] is False
    assert body["delayThresholdMin"] == 15
    assert body["notifyPlatformChange"] is True


@pytest.mark.parametrize(
    "patch",
    [
        {"fromStationId": None},
        {"weekdays": None},
        {"weekdays": []},
        {"alertsEnabled": None},
    ],
)
async def test_patch_commute_rejects_clearing_required_fields(
    client: httpx.AsyncClient, auth: dict[str, str], patch: dict[str, Any]
) -> None:
    follow = (
        await client.post("/v1/follows", headers=auth, json=commute_body())
    ).json()
    r = await client.patch(f"/v1/follows/{follow['id']}", headers=auth, json=patch)
    assert r.status_code == 422


async def test_patch_trip_rejects_commute_fields(
    client: httpx.AsyncClient, auth: dict[str, str]
) -> None:
    follow = (await client.post("/v1/follows", headers=auth, json=trip_body())).json()
    url = f"/v1/follows/{follow['id']}"
    assert (
        await client.patch(url, headers=auth, json={"weekdays": [1]})
    ).status_code == 422
    r = await client.patch(url, headers=auth, json={"notifyPlatformChange": False})
    assert r.status_code == 200
    assert r.json()["notifyPlatformChange"] is False


async def test_delete_follow(client: httpx.AsyncClient, auth: dict[str, str]) -> None:
    follow = (await client.post("/v1/follows", headers=auth, json=trip_body())).json()
    r = await client.delete(f"/v1/follows/{follow['id']}", headers=auth)
    assert r.status_code == 204
    assert (await client.get("/v1/follows", headers=auth)).json() == []
