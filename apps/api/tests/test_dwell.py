"""
A train standing through a long scheduled stop is never early.

The fixture is two real trips of 2026-10-28, each recorded standing at a long
stop: 346 DACIA at Szolnok (arr 03:52, dep 04:21) and 10 TRANSCARPATHIA at
Záhony (arr 03:37, dep 04:40). Interpolating against the timetable used to
show them up to their whole dwell time early (QA BL-2: "-18 korán" for 346,
"-30" for 10), and the forecast carried that forward to "Cegléd ≈04:24".
"""

import copy
import gzip
import json
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np

from api.forecast import serve
from api.services.train_service import TrainService
from api.util.time import service_day_start

FIXTURE = Path(__file__).parent / "fixtures" / "dwell-346-10.json.gz"


def _vehicles() -> dict[str, dict[str, Any]]:
    with gzip.open(FIXTURE, "rt") as f:
        vehicles = json.load(f)
    return {v["trip"]["tripShortName"].split()[0]: v for v in vehicles}


def _at(vehicle: dict[str, Any], seconds: int, **changes: Any) -> dict[str, Any]:
    """Process the vehicle as if reported `seconds` into its service day."""
    vehicle = copy.deepcopy(vehicle)
    start = service_day_start(date.fromisoformat(vehicle["trip"]["serviceDate"]))
    vehicle["lastUpdated"] = int(start.timestamp()) + seconds
    vehicle.update(changes)
    service = TrainService(None)  # type: ignore[arg-type]
    service.reference_time = vehicle["lastUpdated"]
    [processed] = service.process_locations([vehicle])
    return processed


def _stop(vehicle: dict[str, Any], name: str) -> tuple[int, dict[str, Any]]:
    return next(
        (i, st)
        for i, st in enumerate(vehicle["trip"]["stoptimes"])
        if st["stop"]["name"] == name
    )


class _Recovering:
    """A model that expects the train to make up ten minutes everywhere."""

    def predict(self, ex: Any) -> tuple[np.ndarray, None]:
        return ex.cols["delay_s"] - 600, None


def test_346_waiting_at_szolnok_is_on_time() -> None:
    train = _vehicles()["346"]
    index, szolnok = _stop(train, "Szolnok")
    # 04:04, 17 minutes before its scheduled departure
    loc = _at(train, szolnok["scheduledDeparture"] - 17 * 60)

    assert loc["dwellStopIndex"] == index
    assert loc["delay"] == 0
    assert loc["delaySeconds"] == 0


def test_346_still_at_szolnok_after_departure_time_is_late() -> None:
    train = _vehicles()["346"]
    _, szolnok = _stop(train, "Szolnok")
    loc = _at(train, szolnok["scheduledDeparture"] + 17 * 60)

    assert loc["delay"] == 17


def test_346_forecast_never_before_szolnok_departure() -> None:
    train = _vehicles()["346"]
    _, szolnok = _stop(train, "Szolnok")
    cegled_index, cegled = _stop(train, "Cegléd")
    loc = _at(train, szolnok["scheduledDeparture"] - 17 * 60)

    serve.annotate_locations([loc], _Recovering())  # type: ignore[arg-type]

    predicted = {s["index"]: s.get("predictedDelay") for s in loc["processedStops"]}
    assert predicted[cegled_index] == 0
    # Every ≈ time downstream is at or after its timetable
    assert all(v >= 0 for v in predicted.values() if v is not None)
    assert cegled["scheduledArrival"] > szolnok["scheduledDeparture"]


def test_10_waiting_at_zahony_is_on_time() -> None:
    train = _vehicles()["10"]
    # The feed has no speed for it: unknown counts as standing
    assert train["speed"] is None
    index, zahony = _stop(train, "Záhony")
    # 04:10, 30 minutes before its scheduled departure
    loc = _at(train, zahony["scheduledDeparture"] - 30 * 60)

    assert loc["dwellStopIndex"] == index
    assert loc["delay"] == 0


def test_moving_train_near_a_stop_keeps_its_delay() -> None:
    train = _vehicles()["346"]
    _, szolnok = _stop(train, "Szolnok")
    # Rolling out at 30 km/h ten minutes early: genuinely early
    loc = _at(train, szolnok["scheduledDeparture"] - 10 * 60, speed=8.3)

    assert loc["dwellStopIndex"] is None
    assert loc["delay"] < 0


def test_forecast_never_in_the_past() -> None:
    train = _vehicles()["346"]
    _, szolnok = _stop(train, "Szolnok")
    cegled_index, cegled = _stop(train, "Cegléd")
    # Moving, half an hour late: Cegléd can't be passed before now
    now_s = szolnok["scheduledDeparture"] + 30 * 60
    loc = _at(train, now_s, speed=8.3)

    serve.annotate_locations([loc], _Recovering())  # type: ignore[arg-type]

    predicted = {s["index"]: s.get("predictedDelay") for s in loc["processedStops"]}
    assert cegled["scheduledDeparture"] + predicted[cegled_index] * 60 >= now_s - 30
