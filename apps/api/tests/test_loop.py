"""
Routes that come back near themselves (QA NB-1).

The InterCity circle leaves Budapest-Nyugati and ends at Budapest-Keleti a few
km away, so its first and last km pass the same places. 650 TOKAJ of
2026-10-29 left Nyugati on a track 3.2 km from its geometry's first km and
2 m from its last; matched to the nearest point of the line it read "-381"
(six hours early) with "Budapest-Keleti 12:47" as its next stop.
The fixture is that train in five snapshots between 06:19 and 06:31. It ran
via Maglód (line 120a) while its geometry goes via Cegléd, so from 06:25 it
was km away from any part of its route (shown as off route), and nearer the
last pass (3.6 km at 06:28) than the first (5.5 km).
"""

import copy
import gzip
import json
import math
from datetime import date
from pathlib import Path
from typing import Any

import fakeredis
import pytest
from shapely.geometry import LineString, Point

from api.core.redis import add_key
from api.services.train_service import PROGRESS_KEY, TrainService
from api.util.preprocess import MATCH_SLACK_M, PreviousPosition, snap_stops
from api.util.route import projection_candidates, route_from_polyline
from api.util.time import service_day_start

FIXTURE = Path(__file__).parent / "fixtures" / "loop-650.json.gz"


def _snapshots() -> list[dict[str, Any]]:
    with gzip.open(FIXTURE, "rt") as f:
        vehicles: list[dict[str, Any]] = json.load(f)
    return vehicles


def _process(
    vehicle: dict[str, Any], previous: dict[str, PreviousPosition] | None = None
) -> dict[str, Any]:
    service = TrainService(None)  # type: ignore[arg-type]
    service.reference_time = vehicle["lastUpdated"]
    [processed] = service.process_locations([vehicle], previous)
    return processed


def _km(loc: dict[str, Any]) -> float:
    route = route_from_polyline(loc["trip"]["tripGeometry"]["points"])
    assert route.line is not None
    return float(loc["trainPosition"] / route.line.length * route.length_km)


def test_nearest_point_of_the_line_is_the_end_of_the_loop() -> None:
    # The bug's cause, kept as a check that the fixture still shows it
    first = _snapshots()[0]
    route = route_from_polyline(first["trip"]["tripGeometry"]["points"])
    assert route.line is not None

    nearest = route.line.project(Point(first["lon"], first["lat"]))

    assert nearest / route.line.length > 0.98


def test_650_leaving_nyugati_is_at_the_start_of_its_route() -> None:
    located = [_process(vehicle) for vehicle in _snapshots()]

    assert [loc["activity"] for loc in located] == ["running"] * 3 + ["offRoute"] * 2
    for loc in located:
        progress = loc["vehicleProgress"]
        assert progress["lastStop"] == "Budapest-Nyugati"
        assert progress["nextStop"] == "Szolnok"
        assert _km(loc) < 40
        # It left Nyugati 05:55 and stood at Kőbánya: late, never hours early
        assert 0 <= loc["delay"] <= 30


def test_650_follows_its_previous_position() -> None:
    previous: dict[str, PreviousPosition] = {}
    km = [_km(_process(vehicle, previous)) for vehicle in _snapshots()]

    assert len(previous) == 1
    assert km == sorted(km)
    assert km[-1] < 40


def test_650_wrong_previous_position_does_not_stick() -> None:
    first = _snapshots()[0]
    route = route_from_polyline(first["trip"]["tripGeometry"]["points"])
    assert route.line is not None
    trip = first["trip"]
    # As if the last refresh had (wrongly) put it near the end of the loop
    previous = {
        f"{trip['gtfsId']}@{trip['serviceDate']}": PreviousPosition(
            along=route.line.length * 0.985,
            at=first["lastUpdated"] - 30,
            line_length=route.line.length,
        )
    }

    loc = _process(first, previous)

    assert loc["vehicleProgress"]["lastStop"] == "Budapest-Nyugati"


def test_650_at_the_end_of_its_loop_is_still_at_the_end() -> None:
    vehicle = copy.deepcopy(_snapshots()[0])
    route = route_from_polyline(vehicle["trip"]["tripGeometry"]["points"])
    assert route.line is not None
    stoptimes = vehicle["trip"]["stoptimes"]
    hatvan, keleti = stoptimes[-2], stoptimes[-1]
    assert keleti["stop"]["name"] == "Budapest-Keleti"
    # The same place, but in the afternoon on the way into Keleti, 5 min late
    vehicle["lastUpdated"] = int(
        service_day_start(
            date.fromisoformat(vehicle["trip"]["serviceDate"])
        ).timestamp()
        + keleti["scheduledArrival"]
        - 7 * 60
    )
    vehicle["heading"] = 286.0

    loc = _process(vehicle)

    assert loc["vehicleProgress"]["lastStop"] == "Hatvan"
    assert loc["vehicleProgress"]["nextStop"] == "Budapest-Keleti"
    assert hatvan["scheduledDeparture"] < keleti["scheduledArrival"]
    assert -2 <= loc["delay"] <= 8


async def test_refresh_keeps_progress_per_trip() -> None:
    redis = fakeredis.FakeAsyncRedis()
    service = TrainService(redis)
    first = _snapshots()[0]
    trip = first["trip"]
    previous: dict[str, PreviousPosition] = {}
    _ = service.process_locations([first], previous)

    async with redis.pipeline(transaction=True) as pipe:
        service.save_progress(pipe, previous, first["lastUpdated"])
        await pipe.execute()
    loaded = await service.load_progress()

    assert set(loaded) == {f"{trip['gtfsId']}@{trip['serviceDate']}"}
    assert loaded == previous

    # Gone once older than PROGRESS_KEEP_S
    async with redis.pipeline(transaction=True) as pipe:
        service.save_progress(pipe, previous, first["lastUpdated"] + 3600)
        await pipe.execute()
    assert await service.load_progress() == {}


async def test_progress_saved_before_the_delay_loads_without_one() -> None:
    redis = fakeredis.FakeAsyncRedis()
    service = TrainService(redis)
    await redis.hset(  # type: ignore[misc]
        add_key(PROGRESS_KEY), mapping={"1:1@2026-10-29": "[0.5, 1793272071, 6.4]"}
    )

    loaded = await service.load_progress()

    assert loaded == {
        "1:1@2026-10-29": PreviousPosition(along=0.5, at=1793272071, line_length=6.4)
    }
    assert loaded["1:1@2026-10-29"].delay is None


# --- The end of the loop (QA NM-A) ---

# 582 TOKAJ of 2026-10-29 runs the circle the other way: Budapest-Keleti 05:25,
# Hatvan, Miskolc, Nyíregyháza, Debrecen, Szolnok, Budapest-Nyugati 12:05.
# QA recorded it at 12:07:51 (logs3/feed.json, with heading and speed) and at
# 12:11:24 and 12:12:24 (logs3/watch.log) at Kőbánya/Rákos, about 12 min late
# on its way into Nyugati. Its geometry's first km (out of Keleti) was 1.1 km
# away and its last km 3.2 km, so only the first pass was "near", and it read
# "+399" and "+402" with Hatvan as its next stop until 12:12. The trip is as
# the upstream `trip` query returns it.
LOOP_END_FIXTURE = Path(__file__).parent / "fixtures" / "loop-end-582.json.gz"


def _582() -> list[dict[str, Any]]:
    with gzip.open(LOOP_END_FIXTURE, "rt") as f:
        vehicles: list[dict[str, Any]] = json.load(f)
    return vehicles


def test_582_nearest_pass_is_the_start_of_the_loop() -> None:
    # The bug's cause, kept as a check that the fixture still shows it
    first = _582()[0]
    route = route_from_polyline(first["trip"]["tripGeometry"]["points"])
    assert route.line is not None
    candidates = projection_candidates(
        route.coords_array, first["lon"], first["lat"], math.inf
    )
    nearest = min(candidates, key=lambda c: c.metres)
    last = max(candidates, key=lambda c: c.along)

    assert nearest.along / route.line.length < 0.02
    assert last.along / route.line.length > 0.98
    assert last.metres - nearest.metres > MATCH_SLACK_M


def test_582_approaching_nyugati_is_at_the_end_of_its_route() -> None:
    for loc in (_process(vehicle) for vehicle in _582()):
        progress = loc["vehicleProgress"]
        assert progress["lastStop"] == "Szolnok"
        assert progress["nextStop"] == "Budapest-Nyugati"
        assert _km(loc) > 500
        # The board said +12 at Nyugati; it read +399
        assert 5 <= loc["delay"] <= 20


def test_582_follows_its_previous_position_and_delay() -> None:
    previous: dict[str, PreviousPosition] = {}
    located = [_process(vehicle, previous) for vehicle in _582()]

    assert [loc["vehicleProgress"]["nextStop"] for loc in located] == [
        "Budapest-Nyugati"
    ] * 3
    [kept] = previous.values()
    assert kept.delay == pytest.approx(located[-1]["delaySeconds"], abs=1)


def test_582_wrong_previous_position_and_delay_do_not_stick() -> None:
    first, second, _ = _582()
    route = route_from_polyline(first["trip"]["tripGeometry"]["points"])
    assert route.line is not None
    trip = first["trip"]
    # As the old matching left it at 12:07: on the first km, "+399"
    previous = {
        f"{trip['gtfsId']}@{trip['serviceDate']}": PreviousPosition(
            along=route.line.length * 0.012,
            at=first["lastUpdated"],
            line_length=route.line.length,
            delay=399 * 60,
        )
    }

    loc = _process(second, previous)

    assert loc["vehicleProgress"]["nextStop"] == "Budapest-Nyugati"
    assert loc["delay"] <= 20


def test_582_genuinely_late_at_the_start_stays_at_the_start() -> None:
    vehicle = copy.deepcopy(_582()[0])
    stoptimes = vehicle["trip"]["stoptimes"]
    keleti = stoptimes[0]
    assert keleti["stop"]["name"] == "Budapest-Keleti"
    # The same place two and a half hours after it was due to leave Keleti,
    # heading out of Budapest
    vehicle["lastUpdated"] = int(
        service_day_start(
            date.fromisoformat(vehicle["trip"]["serviceDate"])
        ).timestamp()
        + keleti["scheduledDeparture"]
        + 150 * 60
    )
    vehicle["heading"] = 150.0

    loc = _process(vehicle)

    assert loc["vehicleProgress"]["lastStop"] == "Budapest-Keleti"
    assert loc["vehicleProgress"]["nextStop"] == "Hatvan"
    assert _km(loc) < 20
    assert 140 <= loc["delay"] <= 150


# 140 of 2026-08-19 (Nyíregyháza - Wien Westbf), from the replay: at 12:57 on
# its way into Wien Hbf (due 11:20 - 11:30), at 13:01 standing there, 1 m from
# its geometry. Its terminus, Wien Westbf, is 3.5 km on along the route but
# just as near as the crow flies, and a train standing at its terminus after
# its arrival time is on time: matching every very late train to its far
# passes put it there, "61" instead of "91".
LATE_FIXTURE = Path(__file__).parent / "fixtures" / "late-140-wien.json.gz"


def test_very_late_train_on_its_track_stays_where_it_is() -> None:
    with gzip.open(LATE_FIXTURE, "rt") as f:
        arriving, standing = json.load(f)

    with_previous: dict[str, PreviousPosition] = {}
    for previous in (None, with_previous):
        if previous is not None:
            _process(arriving, previous)
        loc = _process(standing, previous)

        assert loc["vehicleProgress"]["nextStop"] == "Wien Hbf"
        assert loc["dwellStopIndex"] is None or (
            loc["trip"]["stoptimes"][loc["dwellStopIndex"]]["stop"]["name"]
            == "Wien Hbf"
        )
        assert loc["delay"] >= 90


# --- Geometry ---

# A loop: east, north, west and back south, ending ~22 m north of its start
LOOP = [(19.0, 47.0), (19.2, 47.0), (19.2, 47.1), (19.0, 47.1), (19.0, 47.0002)]


def test_candidates_are_each_pass() -> None:
    import numpy as np

    near_start = projection_candidates(np.asarray(LOOP), 19.0001, 47.0001, 500)

    assert len(near_start) == 2
    first, last = near_start
    assert first.along == pytest.approx(0.0001, abs=1e-6)
    # The end of the line, 11 m from the point
    assert last.along == pytest.approx(LineString(LOOP).length, abs=1e-9)
    assert first.bearing == pytest.approx(90, abs=0.1)
    assert last.bearing == pytest.approx(180, abs=0.1)


def test_stops_keep_their_timetable_order_on_a_loop() -> None:
    stops = [
        {"id": "Start", "index": 0, "coords": [19.0, 47.0]},
        {"id": "East", "index": 1, "coords": [19.2, 47.05]},
        # Nearer the first km (10 m) than the last (12 m), but last
        {"id": "End", "index": 2, "coords": [19.0, 47.00009]},
    ]
    line = LineString(LOOP)
    assert line.project(Point(19.0, 47.00009)) < 0.01

    snapped = snap_stops(LOOP, stops)

    assert [s["id"] for s in snapped] == ["Start", "East", "End"]
    assert snapped[-1]["distanceAlongRoute"] > 0.99 * line.length
