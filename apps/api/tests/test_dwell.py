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
    # Rolling out at 36 km/h ten minutes early: genuinely early
    loc = _at(train, szolnok["scheduledDeparture"] - 10 * 60, speed=10.0)

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


# 406 CORONA of 2026-10-28 (it runs overnight) at Debrecen, due 06:05 - 06:29
# the next morning: at 06:19 standing 1.1 km past the station's point, at
# 06:27 back at it, at 06:31 leaving at 9 m/s (QA NM-1: "-17 korán" and
# "Püspökladány ≈06:41" while it waited)
DEBRECEN_FIXTURE = Path(__file__).parent / "fixtures" / "dwell-406-debrecen.json.gz"


def _406() -> list[dict[str, Any]]:
    with gzip.open(DEBRECEN_FIXTURE, "rt") as f:
        vehicles: list[dict[str, Any]] = json.load(f)
    return vehicles


def _process_at_report(vehicle: dict[str, Any], **changes: Any) -> dict[str, Any]:
    vehicle = copy.deepcopy(vehicle)
    vehicle.update(changes)
    service = TrainService(None)  # type: ignore[arg-type]
    service.reference_time = vehicle["lastUpdated"]
    [processed] = service.process_locations([vehicle])
    return processed


def test_406_waiting_past_the_station_point_is_on_time() -> None:
    standing, at_point, _ = _406()
    index, _ = _stop(standing, "Debrecen")

    for vehicle in (standing, at_point):
        loc = _process_at_report(vehicle)
        assert loc["vehicleProgress"]["lastStopIndex"] == index
        assert loc["dwellStopIndex"] == index
        assert loc["delay"] == 0


def test_406_creeping_in_the_station_is_on_time() -> None:
    standing, _, _ = _406()
    index, _ = _stop(standing, "Debrecen")

    # About 11 km/h, 10 min before its departure
    loc = _process_at_report(standing, speed=3.0)

    assert loc["dwellStopIndex"] == index
    assert loc["delay"] == 0


def test_406_shunting_in_the_station_is_on_time() -> None:
    standing, _, _ = _406()
    index, _ = _stop(standing, "Debrecen")

    # QA's reading: 8 m/s (29 km/h) within the station at 06:13
    loc = _process_at_report(standing, speed=8.0)

    assert loc["dwellStopIndex"] == index
    assert loc["delay"] == 0


def test_406_forecast_never_before_debrecen_departure() -> None:
    standing, _, _ = _406()
    _, debrecen = _stop(standing, "Debrecen")
    ladany_index, ladany = _stop(standing, "Püspökladány")
    loc = _process_at_report(standing, speed=3.0)

    serve.annotate_locations([loc], _Recovering())  # type: ignore[arg-type]

    predicted = {s["index"]: s.get("predictedDelay") for s in loc["processedStops"]}
    run = ladany["scheduledDeparture"] - debrecen["scheduledDeparture"]
    # At most the timetable's padding early (about 1.5 min), not the model's
    # ten minutes; it read 17 min early
    assert predicted[ladany_index] * 60 >= -max(60, 0.05 * run) - 30


def test_406_leaving_after_its_departure_time_is_late() -> None:
    _, _, leaving = _406()

    loc = _process_at_report(leaving)

    assert leaving["speed"] == 9.0
    assert loc["dwellStopIndex"] is None
    assert loc["delay"] >= 1


def test_406_standing_past_the_station_after_departure_is_late() -> None:
    standing, _, _ = _406()
    _, debrecen = _stop(standing, "Debrecen")
    start = service_day_start(date.fromisoformat(standing["trip"]["serviceDate"]))
    # Still 1.1 km past the point, ten minutes after its departure time
    loc = _process_at_report(
        standing,
        lastUpdated=int(start.timestamp()) + debrecen["scheduledDeparture"] + 600,
    )

    assert loc["dwellStopIndex"] is None
    assert loc["delay"] >= 9
