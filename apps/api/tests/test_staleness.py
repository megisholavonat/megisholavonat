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
    STALE_GREY_AFTER_S,
    STALE_HIDE_AFTER_S,
    activity,
    is_active,
    is_far_from_route,
    is_stale,
    is_stale_or_inactive,
    should_remove,
)

# 08:00 Budapest time on the service date
NOW = datetime(2026, 8, 14, 8, 0, tzinfo=BUDAPEST_TZ).timestamp()
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
    service_date: str = "2026-08-14",
    duration: int = 3600,
) -> dict[str, Any]:
    return {
        "vehicleId": "v",
        "lat": lat,
        "lon": lon,
        "lastUpdated": int(last_updated),
        "trip": {
            "serviceDate": service_date,
            "tripGeometry": {"points": POINTS},
            "stoptimes": [
                stoptime(ORIGIN, departs),
                stoptime(DESTINATION, departs + duration),
            ],
        },
    }


def test_fresh_running_train_is_not_flagged() -> None:
    v = vehicle()
    assert not is_stale(v, NOW)
    assert is_active(v, NOW)
    assert not is_stale_or_inactive(v, NOW)


def test_thresholds_match_core() -> None:
    # packages/core/src/constants.ts: STALE_GREY_AFTER_S / STALE_HIDE_AFTER_S
    assert STALE_GREY_AFTER_S == 5 * 60
    assert STALE_HIDE_AFTER_S == 30 * 60


def test_no_update_for_over_5_minutes_is_stale() -> None:
    assert not is_stale(vehicle(last_updated=NOW - 5 * 60), NOW)
    v = vehicle(last_updated=NOW - 5 * 60 - 1)
    assert is_stale(v, NOW)
    assert is_stale_or_inactive(v, NOW)


def test_no_update_for_over_30_minutes_is_removed() -> None:
    assert not should_remove(vehicle(last_updated=NOW - 30 * 60), NOW)
    assert should_remove(vehicle(last_updated=NOW - 30 * 60 - 1), NOW)
    # Grey but still shown in between
    v = vehicle(last_updated=NOW - 10 * 60)
    assert is_stale(v, NOW)
    assert not should_remove(v, NOW)


def test_waiting_at_origin_before_departure_is_inactive() -> None:
    v = vehicle(lat=47.0, lon=19.005, departs=EIGHT_AM + 300)
    assert not is_active(v, NOW)
    assert is_stale_or_inactive(v, NOW)
    # Once departure time has passed it counts as running
    assert is_active(vehicle(lat=47.0, lon=19.005, departs=EIGHT_AM - 60), NOW)


def _local(iso: str) -> float:
    return datetime.fromisoformat(iso).replace(tzinfo=BUDAPEST_TZ).timestamp()


@pytest.mark.parametrize(
    ("now", "active"),
    [
        # Waiting for its 00:18 departure; read naively it was 24h past it
        ("2026-08-15T00:10:00", False),
        ("2026-08-15T00:20:00", True),
        # Before midnight; read naively it was 23h past its departure
        ("2026-08-14T23:50:00", False),
    ],
)
def test_after_midnight_hev_with_previous_day_service_date(
    now: str, active: bool
) -> None:
    # HÉV night trips after midnight carry the previous day's service date
    # with stoptimes under 86400: 00:18 on 08-15 reads as 1080 on 08-14
    v = vehicle(lat=47.0, lon=19.005, departs=18 * 60, service_date="2026-08-14")
    assert is_active(v, _local(now)) is active


@pytest.mark.parametrize(
    ("now", "active"),
    [
        # Before its 22:40 departure the day before the listed date
        ("2026-08-14T22:30:00", False),
        # Departed but still near the origin; read naively it was 24h early
        ("2026-08-14T22:45:00", True),
    ],
)
def test_overnight_train_with_next_day_service_date(now: str, active: bool) -> None:
    # An overnight train departing 22:40 on 08-14, listed under 08-15
    v = vehicle(
        lat=47.0,
        lon=19.005,
        departs=22 * 3600 + 40 * 60,
        service_date="2026-08-15",
        duration=8 * 3600,
    )
    assert is_active(v, _local(now)) is active


@pytest.mark.parametrize(
    ("now", "active"),
    [
        # 27:00 on the service clock is 03:00 CET, i.e. 04:00 CEST: the day
        # starts at local noon minus 12h, not by wall-clock hours
        ("2026-03-29T03:30:00", False),
        ("2026-03-29T04:05:00", True),
    ],
)
def test_waiting_at_origin_across_spring_dst_change(now: str, active: bool) -> None:
    v = vehicle(lat=47.0, lon=19.005, departs=27 * 3600, service_date="2026-03-28")
    assert is_active(v, _local(now)) is active


def test_daytime_train_keeps_its_service_date() -> None:
    # Departs 10:00 on 08-14; still attached near its origin at 20:43, but
    # neither neighbouring date fits the schedule far better than the listed one
    v = vehicle(lat=47.0, lon=19.005, departs=10 * 3600)
    assert not is_active(v, NOW)
    assert is_active(v, _local("2026-08-14T20:43:00"))


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


def test_activity_names_why_a_train_is_not_running() -> None:
    assert activity(vehicle(), NOW) == "running"
    waiting = vehicle(lon=19.005, departs=EIGHT_AM + 300)
    assert activity(waiting, NOW) == "beforeDeparture"
    assert activity(vehicle(lon=19.495), NOW) == "arrived"
    assert activity(vehicle(lat=47.03), NOW) == "offRoute"


def test_train_still_pulling_into_its_terminus_is_running() -> None:
    # ~380 m out at 40 km/h: arriving in half a minute, but not there yet
    pulling_in = {**vehicle(lon=19.495), "speed": 40 / 3.6}
    assert activity(pulling_in, NOW) == "running"
    standing = {**vehicle(lon=19.495), "speed": 0.0}
    assert activity(standing, NOW) == "arrived"


def test_cancelled_when_every_stop_ahead_is_cancelled() -> None:
    v = vehicle()
    v["vehicleProgress"] = {"nextStopIndex": 1}
    v["trip"]["stoptimes"][1]["realtimeState"] = "CANCELED"
    assert activity(v, NOW) == "cancelled"
    # A cancelled stop already behind the train does not count
    v["trip"]["stoptimes"][1]["realtimeState"] = "UPDATED"
    v["trip"]["stoptimes"][0]["realtimeState"] = "CANCELED"
    assert activity(v, NOW) == "running"


async def test_feed_and_details_carry_the_same_state(
    client: httpx.AsyncClient,
    redis: fakeredis.FakeAsyncRedis,
) -> None:
    await TrainService(redis).refresh_data()

    features = (await client.get("/v1/trains")).json()["features"]
    assert features
    activities = set()
    for feature in features:
        props = feature["properties"]
        details = (await client.get(f"/v1/trains/{props['vehicleId']}")).json()
        assert details["activity"] == props["activity"]
        assert details["delay"] == props["delay"]
        assert details["lastUpdated"] == props["lastUpdated"]
        if props["activity"] != "running":
            assert props["isStale"]
        activities.add(props["activity"])
    assert "running" in activities
