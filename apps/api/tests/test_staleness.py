"""Stale / inactive flag of the train list (port of core's vehicle.ts)."""

from datetime import datetime
from typing import Any

import fakeredis
import httpx
import polyline  # type: ignore[import-untyped]
import pytest

from api.services.train_service import TrainService
from api.util.time import BUDAPEST_TZ
from api.util.vehicle import (
    is_active,
    is_far_from_route,
    is_stale,
    is_stale_or_inactive,
)

# 08:00 Budapest time on the service date
NOW = BUDAPEST_TZ.localize(datetime(2026, 8, 14, 8, 0)).timestamp()
EIGHT_AM = 8 * 3600

# A straight east-west line of about 38 km
ORIGIN = (47.0, 19.0)
DESTINATION = (47.0, 19.5)
POINTS = polyline.encode([ORIGIN, (47.0, 19.25), DESTINATION])


def stoptime(lat_lon: tuple[float, float], at: int) -> dict[str, Any]:
    return {
        "scheduledArrival": at,
        "realtimeArrival": at,
        "scheduledDeparture": at,
        "realtimeDeparture": at,
        "stop": {"name": "x", "lat": lat_lon[0], "lon": lat_lon[1]},
    }


def vehicle(
    lat: float = 47.0,
    lon: float = 19.25,
    last_updated: float = NOW - 60,
    departs: int = EIGHT_AM - 1800,
) -> dict[str, Any]:
    return {
        "vehicleId": "v",
        "lat": lat,
        "lon": lon,
        "lastUpdated": int(last_updated),
        "trip": {
            "serviceDate": "2026-08-14",
            "tripGeometry": {"points": POINTS},
            "stoptimes": [
                stoptime(ORIGIN, departs),
                stoptime(DESTINATION, departs + 3600),
            ],
        },
    }


def test_fresh_running_train_is_not_flagged() -> None:
    v = vehicle()
    assert not is_stale(v, NOW)
    assert is_active(v, NOW)
    assert not is_stale_or_inactive(v, NOW)


def test_no_update_for_over_30_minutes_is_stale() -> None:
    assert not is_stale(vehicle(last_updated=NOW - 30 * 60), NOW)
    v = vehicle(last_updated=NOW - 31 * 60)
    assert is_stale(v, NOW)
    assert is_stale_or_inactive(v, NOW)


def test_waiting_at_origin_before_departure_is_inactive() -> None:
    v = vehicle(lat=47.0, lon=19.005, departs=EIGHT_AM + 300)
    assert not is_active(v, NOW)
    assert is_stale_or_inactive(v, NOW)
    # Once departure time has passed it counts as running
    assert is_active(vehicle(lat=47.0, lon=19.005, departs=EIGHT_AM - 60), NOW)


def test_at_destination_is_inactive() -> None:
    assert not is_active(vehicle(lat=47.0, lon=19.495), NOW)


def test_far_from_route_is_inactive() -> None:
    near = vehicle(lat=47.01)  # ~1.1 km off the line
    far = vehicle(lat=47.03)  # ~3.3 km off, still inside the bbox buffer
    outside = vehicle(lat=47.5)  # outside the bounding box
    assert not is_far_from_route(near)
    assert is_far_from_route(far)
    assert is_far_from_route(outside)
    assert not is_active(far, NOW)


def test_without_stoptimes_is_active() -> None:
    v = vehicle(lat=47.5)
    v["trip"]["stoptimes"] = []
    assert is_active(v, NOW)


def test_judged_against_given_time() -> None:
    v = vehicle(last_updated=NOW - 60)
    assert not is_stale(v, NOW)
    assert is_stale(v, NOW + 3600)


@pytest.mark.parametrize("snapshot_offset", [0, 3])
async def test_replay_judges_against_snapshot_time(
    client: httpx.AsyncClient,
    redis: fakeredis.FakeAsyncRedis,
    snapshot_offset: int,
) -> None:
    service = TrainService(redis)
    for _ in range(snapshot_offset + 1):
        await service.refresh_data()

    features = (await client.get("/v1/trains")).json()["features"]
    props = {f["properties"]["vehicleId"]: f["properties"] for f in features}

    # The fixture is from August; against the wall clock every train would be
    # stale. Against the snapshot time only the one inactive train is flagged.
    assert all(isinstance(p["lastUpdated"], int) for p in props.values())
    assert all(p["lastUpdated"] > 0 for p in props.values())
    assert sum(p["isStale"] for p in props.values()) == 1
