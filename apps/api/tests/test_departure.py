"""
Regression: a train waiting at its origin reports the heading it arrived with,
which points away from its route. The heading-aware projection used to move
it to the nearest segment facing that way, wherever on the route it was.

The fixture is train 10 (Budapest-Keleti -> Kyiv) on 2026-09-01: two
snapshots standing at Keleti facing west, the one where it starts moving, and
one a few minutes out. A normally running train (4848) rides along for
contrast. It used to be placed between Debrecen and Nyiregyhaza, ~237 minutes
"early", and its watermark skipped Keleti, Szolnok and Debrecen in history.
"""

import gzip
import json
from pathlib import Path
from typing import Any

import pytest
from shapely.geometry import LineString, Point

from api.services.history import detect_passages
from api.services.train_service import TrainService
from api.util.preprocess import project_with_heading

FIXTURE = Path(__file__).parent / "fixtures" / "train10-departure.jsonl.gz"
TRAIN_10 = "1:918061939487"
TRAIN_4848 = "1:945514150370"


def _snapshots() -> list[dict[str, Any]]:
    with gzip.open(FIXTURE, "rt") as f:
        return [json.loads(line) for line in f]


def _processed() -> list[dict[str, dict[str, Any]]]:
    """Processed locations per snapshot, keyed by vehicle id."""
    service = TrainService(None)  # type: ignore[arg-type]
    result = []
    for snap in _snapshots():
        service.reference_time = snap["fetched_at_unix"]
        processed = service.process_locations(snap["vehicles"])
        result.append({loc["vehicleId"]: loc for loc in processed})
    return result


# --- Geometry ---

# A U: east along 47.0, north, then west along 47.1 (~11 km from the first leg)
U_ROUTE = LineString([(19.0, 47.0), (19.1, 47.0), (19.1, 47.1), (19.0, 47.1)])


def test_stale_heading_does_not_jump_to_a_distant_segment() -> None:
    # At the start of the route, facing backwards (west)
    point = Point(19.0005, 47.0)

    position = project_with_heading(U_ROUTE, point, 270.0)

    assert position == pytest.approx(0.0005)


def test_heading_still_picks_the_return_leg_of_an_out_and_back() -> None:
    # Out along 47.0 and back ~5 m further north
    route = LineString([(19.0, 47.0), (19.1, 47.0), (19.0, 47.00005)])
    point = Point(19.03, 47.00003)

    # Heading west: on the way back, 0.07 after the turn
    assert project_with_heading(route, point, 270.0) == pytest.approx(0.17, abs=1e-4)
    # Heading east: on the way out
    assert project_with_heading(route, point, 90.0) == pytest.approx(0.03, abs=1e-4)


# --- Train 10 at Budapest-Keleti ---


def test_waiting_at_origin_stays_at_origin() -> None:
    waiting = [snap[TRAIN_10] for snap in _processed()[:2]]

    for loc in waiting:
        assert loc["heading"] == 270.0
        assert loc["speed"] == 0.0
        progress = loc["vehicleProgress"]
        assert progress["lastStop"] == "Budapest-Keleti"
        assert progress["nextStop"] == "Szolnok"
        assert progress["lastStopIndex"] == 0
        assert loc["trainPosition"] < 0.01
    # Minutes until the 22:40 departure, not hours
    assert [loc["delay"] for loc in waiting] == [-21, -1]


def test_after_departure_unchanged() -> None:
    departing = [snap[TRAIN_10] for snap in _processed()[2:]]

    assert [loc["delay"] for loc in departing] == [0, 3]
    for loc in departing:
        assert loc["vehicleProgress"]["lastStop"] == "Budapest-Keleti"
        assert loc["vehicleProgress"]["nextStop"] == "Szolnok"


def test_running_train_unaffected() -> None:
    delays = [snap[TRAIN_4848]["delay"] for snap in _processed()]

    assert delays == [9, 13, 12, 11]


def test_history_records_origin_after_waiting() -> None:
    watermark = None
    recorded = []
    for snap in _processed():
        passages, watermark = detect_passages(snap[TRAIN_10], watermark)
        recorded += [(p.row["stop_sequence"], p.row["delay_s"]) for p in passages]

    # Keleti departed ~3 minutes late; the watermark never jumped ahead
    assert recorded == [(0, 160)]
    assert watermark == 0
