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
    # Leaving Szolnok on time, it can gain only its timetable's padding by
    # Cegléd (24 min), not the ten minutes the model hopes for
    run = cegled["scheduledDeparture"] - szolnok["scheduledDeparture"]
    assert run == 24 * 60
    assert predicted[cegled_index] == -1
    # No ≈ time downstream is more than a minute or 5% of the run early
    for stop in loc["processedStops"]:
        value = predicted.get(stop["index"])
        st = train["trip"]["stoptimes"][stop["index"]]
        if value is None or st["scheduledArrival"] is None:
            continue
        run = st["scheduledArrival"] - szolnok["scheduledDeparture"]
        assert value * 60 >= -max(60, 0.05 * run) - 30


def test_forecast_lets_a_dwelling_train_gain_padding() -> None:
    # Away from the stop it stands at, the timetable's padding may make the
    # train early, as it does at the terminus
    floor = serve._floor(now_s=1000, sched=4600, dwell_dep=1600, at_dwell_stop=False)
    at_stop = serve._floor(now_s=1000, sched=1600, dwell_dep=1600, at_dwell_stop=True)
    late = serve._floor(now_s=2200, sched=4600, dwell_dep=1600, at_dwell_stop=False)

    assert floor == -150  # 5% of the 50 min run
    assert at_stop == 0
    # Still standing ten minutes after its departure time
    assert late == 600 - 150


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


# 19915 railjet xpress of 2026-08-18, due at Budapest-Kelenföld 21:02 - 21:18:
# at 21:11 held 512 m short of the stop, at 21:12 berthed 204 m short
HELD_FIXTURE = Path(__file__).parent / "fixtures" / "held-19915-kelenfold.json.gz"


def _held_19915() -> list[dict[str, Any]]:
    with gzip.open(HELD_FIXTURE, "rt") as f:
        vehicles: list[dict[str, Any]] = json.load(f)
    service = TrainService(None)  # type: ignore[arg-type]
    processed = []
    for vehicle in vehicles:
        service.reference_time = vehicle["lastUpdated"]
        processed.extend(service.process_locations([vehicle]))
    return processed


def test_held_short_of_the_next_stop_is_late_against_its_arrival() -> None:
    held, _ = _held_19915()
    index, kelenfold = _stop(held, "Budapest-Kelenföld")
    start = service_day_start(date.fromisoformat(held["trip"]["serviceDate"]))
    now_s = held["lastUpdated"] - int(start.timestamp())

    assert held["dwellStopIndex"] == index
    assert held["vehicleProgress"]["nextStopIndex"] == index
    # Ten minutes past its arrival time and not there yet: not "on time"
    assert now_s - kelenfold["scheduledArrival"] == 577
    assert held["delay"] == 10


def test_berthed_short_of_the_stops_point_waits_on_time() -> None:
    _, berthed = _held_19915()
    index, _ = _stop(berthed, "Budapest-Kelenföld")

    # A long platform: standing 204 m short, before its departure time
    assert berthed["dwellStopIndex"] == index
    assert berthed["delay"] == 0
