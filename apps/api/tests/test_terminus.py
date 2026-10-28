"""
Regression: trains were almost never recorded at their final stop. A train
does not get past its terminus, so the "300 m beyond the stop" rule cannot
fire there, and the stop point often sits at the very end of the trip
geometry, so `progress == 1` is rare too. The feed's last report usually puts
the train ~50 m before the stop (speed unknown), after which the vehicle
vanishes or moves on to its next trip.

The fixture holds real snapshots from 2026-08-19, trimmed to four vehicles:
  - 3030 vanishes right after its last report at Hatvan;
  - 38219 is re-assigned to its next trip (38210) at Szentlőrinc;
  - 4219 arrives at Pusztaszabolcs with a regular GPS fix past the stop;
  - 5434 stands at Putnok for half an hour and vanishes: it never ran its
    last leg to Ózd, so it must not get a terminus passage.
"""

import gzip
import json
from pathlib import Path
from typing import Any

import polyline  # type: ignore[import-untyped]
import pytest

from api.services.history import Passage, detect_passages
from api.services.train_service import TrainService

FIXTURE = Path(__file__).parent / "fixtures" / "terminus-cases.jsonl.gz"

TRIP_3030 = "1:29649128"
TRIP_38219 = "1:28522095"
TRIP_38210 = "1:28522086"
TRIP_4219 = "1:32739695"
TRIP_5434 = "1:28518990"


def _replay() -> tuple[dict[str, list[Passage]], dict[str, int | None], dict]:
    """
    Run the fixture through the recorder's pipeline (as the backfill does).
    Returns passages and the final watermark per trip, and each trip's stops.
    """
    service = TrainService(None)  # type: ignore[arg-type]
    watermarks: dict[str, int | None] = {}
    passages: dict[str, list[Passage]] = {}
    stoptimes: dict[str, list[dict[str, Any]]] = {}
    with gzip.open(FIXTURE, "rt") as f:
        for line in f:
            snap = json.loads(line)
            service.reference_time = snap["fetched_at_unix"]
            locations = service.process_locations(
                service.add_counties_to_locations(
                    service.dedupe_by_vehicle_id(snap["vehicles"])
                )
            )
            for loc in locations:
                trip_id = loc["trip"]["gtfsId"]
                stoptimes[trip_id] = loc["trip"]["stoptimes"]
                found, wm = detect_passages(loc, watermarks.get(trip_id))
                watermarks[trip_id] = wm
                passages.setdefault(trip_id, []).extend(found)
    return passages, watermarks, stoptimes


@pytest.fixture(scope="module")
def replay() -> tuple[dict[str, list[Passage]], dict[str, int | None], dict]:
    return _replay()


def _terminus(replay: tuple, trip_id: str) -> dict[str, Any] | None:
    passages, _, stoptimes = replay
    final = len(stoptimes[trip_id]) - 1
    rows = [p.row for p in passages.get(trip_id, [])]
    return next((r for r in rows if r["stop_sequence"] == final), None)


def test_vanishing_at_terminus_is_recorded(replay: tuple) -> None:
    row = _terminus(replay, TRIP_3030)

    assert row is not None
    assert row["stop_id"] == replay[2][TRIP_3030][-1]["stop"]["gtfsId"]
    # Measured against the scheduled arrival (01:58), from the last report
    assert row["scheduled_arrival_s"] == 7080
    assert row["observed_at"].timestamp() == 1787097772
    assert row["delay_s"] == pytest.approx(293, abs=5)
    assert row["otp_arrival_delay_s"] == 180


def test_reassigned_to_next_trip_at_terminus_is_recorded(replay: tuple) -> None:
    row = _terminus(replay, TRIP_38219)

    assert row is not None
    assert row["scheduled_arrival_s"] == 15120
    assert row["observed_at"].timestamp() == 1787105686
    assert row["delay_s"] == pytest.approx(172, abs=5)
    # The next trip, standing at its origin, has passed nothing yet
    assert replay[0].get(TRIP_38210, []) == []


def test_normal_arrival_is_recorded_once(replay: tuple) -> None:
    passages, watermarks, stoptimes = replay
    final = len(stoptimes[TRIP_4219]) - 1
    row = _terminus(replay, TRIP_4219)

    assert row is not None
    assert row["scheduled_arrival_s"] == 14460
    # The first fix past the stop, not the later report from ~50 m before it
    assert row["observed_at"].timestamp() == 1787104886
    assert row["delay_s"] == pytest.approx(26, abs=5)
    assert [p.row["stop_sequence"] for p in passages[TRIP_4219]].count(final) == 1
    assert watermarks[TRIP_4219] == final


def test_short_turned_train_gets_no_terminus_passage(replay: tuple) -> None:
    _, watermarks, stoptimes = replay
    final = len(stoptimes[TRIP_5434]) - 1

    assert _terminus(replay, TRIP_5434) is None
    assert stoptimes[TRIP_5434][-1]["stop"]["name"] == "Ózd"
    wm = watermarks[TRIP_5434]
    assert wm is not None
    assert wm < final - 1


# --- Synthetic geometry ---

LAT = 47.0


def _location(stop_lons: list[float], lon: float, speed: float | None) -> dict:
    """A processed location on a straight east-west line through the stops."""
    times = [10 * 3600 + i * 300 for i in range(len(stop_lons))]
    trip = {
        "gtfsId": "1:trip",
        "serviceDate": "2026-08-14",
        "route": {"shortName": "S1", "mode": "RAIL"},
        "tripGeometry": {"points": polyline.encode([(LAT, x) for x in stop_lons])},
        "stoptimes": [
            {
                "scheduledArrival": t,
                "scheduledDeparture": t,
                "stop": {"gtfsId": f"1:s{i}", "name": f"S{i}", "lat": LAT, "lon": x},
            }
            for i, (x, t) in enumerate(zip(stop_lons, times, strict=True))
        ],
    }
    # On schedule at that point of the line; the service day starts at
    # 2026-08-14 00:00 Budapest time (22:00 UTC the day before)
    first, last = stop_lons[0], stop_lons[-1]
    sched = times[0] + (times[-1] - times[0]) * (lon - first) / (last - first)
    at = 1786658400 + int(sched)
    service = TrainService(None)  # type: ignore[arg-type]
    service.reference_time = at
    vehicle = {
        "vehicleId": "1:veh",
        "lat": LAT,
        "lon": lon,
        "heading": 90.0,
        "speed": speed,
        "lastUpdated": at,
        "trip": trip,
    }
    [processed] = service.process_locations([vehicle])
    return processed


# 0.001 degrees of longitude is ~76 m here
@pytest.mark.parametrize(
    ("lon", "speed", "reached"),
    [
        (19.2982, 20.0, True),  # ~140 m short, moving
        (19.297, 20.0, False),  # ~230 m short, moving
        (19.295, 0.0, True),  # ~380 m short, standing
        (19.295, None, True),  # ~380 m short, speed unknown
        (19.292, 0.0, False),  # ~610 m short, standing
    ],
)
def test_terminus_radius(lon: float, speed: float | None, reached: bool) -> None:
    loc = _location([19.0, 19.1, 19.2, 19.3], lon, speed)

    passages, wm = detect_passages(loc, 1)

    assert (3 in [p.row["stop_sequence"] for p in passages]) is reached
    assert wm == (3 if reached else 2)


def test_standing_at_nearby_previous_stop_is_not_arrival() -> None:
    # The last two stops ~150 m apart; the train stands at the previous one
    loc = _location([19.0, 19.1, 19.2, 19.202], 19.2001, 0.0)

    passages, wm = detect_passages(loc, 1)

    assert 3 not in [p.row["stop_sequence"] for p in passages]
    assert wm != 3
