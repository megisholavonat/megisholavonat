"""GPS delay for trips around midnight, mismatched service dates and DST."""

from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import polyline  # type: ignore[import-untyped]
import pytest

from api.services.train_service import TrainService
from api.util.time import service_day_start
from api.util.trip import seconds_into_service_day

BUDAPEST = ZoneInfo("Europe/Budapest")
LAT = 47.0
# Four stops along a straight east-west line
STOP_LONS = [19.0, 19.1, 19.2, 19.3]


def _local(iso: str) -> int:
    return int(datetime.fromisoformat(iso).replace(tzinfo=BUDAPEST).timestamp())


def _on_service_clock(service_date: str, seconds: int) -> int:
    """The instant a stoptime value means on a service date (as OTP reads it)."""
    start = service_day_start(date.fromisoformat(service_date))
    return int((start + timedelta(seconds=seconds)).timestamp())


def _vehicle(
    service_date: str, stop_times: list[int], leg: int, at: int
) -> dict[str, Any]:
    """A vehicle halfway between stop `leg` and stop `leg + 1`."""
    stoptimes = [
        {
            "scheduledArrival": t,
            "scheduledDeparture": t,
            "stop": {"gtfsId": f"1:stop{i}", "name": f"Stop {i}", "lat": LAT, "lon": x},
        }
        for i, (x, t) in enumerate(zip(STOP_LONS, stop_times, strict=True))
    ]
    return {
        "vehicleId": "1:veh",
        "lat": LAT,
        "lon": (STOP_LONS[leg] + STOP_LONS[leg + 1]) / 2,
        "heading": 90.0,
        "lastUpdated": at,
        "trip": {
            "gtfsId": "1:trip",
            "serviceDate": service_date,
            "tripGeometry": {
                "points": polyline.encode([(LAT, lon) for lon in STOP_LONS])
            },
            "stoptimes": stoptimes,
        },
    }


def _delay(vehicle: dict[str, Any]) -> int:
    service = TrainService(None)  # type: ignore[arg-type]
    service.reference_time = vehicle["lastUpdated"]
    [processed] = service.process_locations([vehicle])
    delay: int = processed["delay"]
    return delay


def _times(first: int, step: int = 600) -> list[int]:
    return [first + i * step for i in range(len(STOP_LONS))]


# Service date 2026-08-14: 23:40, 23:50, 24:00, 24:10 (OTP: past 86400)
NIGHT = _times(23 * 3600 + 40 * 60)


@pytest.mark.parametrize(
    ("leg", "now", "expected"),
    [
        # Before midnight, on time
        (0, "2026-08-14T23:45:00", 0),
        # After midnight, on time and 7 min late
        (2, "2026-08-15T00:05:00", 0),
        (2, "2026-08-15T00:12:00", 7),
    ],
)
def test_trip_crossing_midnight(leg: int, now: str, expected: int) -> None:
    assert _delay(_vehicle("2026-08-14", NIGHT, leg, _local(now))) == expected


def test_after_midnight_trip_with_previous_day_service_date() -> None:
    # HÉV night trips: 00:18 on 08-15 is listed as service date 08-14 with
    # stoptimes from 1080, not 87480. This showed as a 1440 min delay.
    vehicle = _vehicle("2026-08-14", _times(18 * 60), 0, _local("2026-08-15T00:25:00"))
    assert _delay(vehicle) == 2


def test_waiting_before_midnight_for_an_after_midnight_departure() -> None:
    # Same feed quirk, seen at 23:53 before its 00:13 departure (was +1415)
    vehicle = _vehicle("2026-08-14", _times(13 * 60), 0, _local("2026-08-14T23:53:00"))
    assert _delay(vehicle) == -25


def test_overnight_train_with_next_day_service_date() -> None:
    # Departed 22:40 on 08-14 but listed under 08-15; at 04:00 on 08-15 it is
    # halfway between its 02:00 (26h) and 06:00 (30h) stops. Was -1440.
    stop_times = [22 * 3600 + 40 * 60, 26 * 3600, 30 * 3600, 34 * 3600]
    vehicle = _vehicle("2026-08-15", stop_times, 1, _local("2026-08-15T04:03:00"))
    assert _delay(vehicle) == 3


@pytest.mark.parametrize(
    ("service_date", "now"),
    [
        # Spring forward, 02:00 -> 03:00 on 2026-03-29
        ("2026-03-29", "2026-03-29T10:05:00"),
        # Fall back, 03:00 -> 02:00 on 2026-10-25
        ("2026-10-25", "2026-10-25T10:05:00"),
    ],
)
def test_on_time_during_dst_change_day(service_date: str, now: str) -> None:
    vehicle = _vehicle(service_date, _times(10 * 3600), 0, _local(now))
    assert _delay(vehicle) == 0


@pytest.mark.parametrize("service_date", ["2026-03-28", "2026-10-24"])
def test_night_train_across_dst_change(service_date: str) -> None:
    # 23:00, 25:00, 27:00, 29:00 on the service clock (noon minus 12h)
    stop_times = _times(23 * 3600, 2 * 3600)
    for leg in range(3):
        midway = stop_times[leg] + 3600
        vehicle = _vehicle(
            service_date, stop_times, leg, _on_service_clock(service_date, midway)
        )
        assert _delay(vehicle) == 0


def test_finished_trip_keeps_its_service_date() -> None:
    # Ran 04:30-12:56; still attached at 20:43 the same day. Neither
    # neighbouring date fits the schedule far better, so nothing is shifted.
    trip = {
        "serviceDate": "2026-08-20",
        "stoptimes": [
            {"scheduledDeparture": 16140, "scheduledArrival": 16140},
            {"scheduledDeparture": 46560, "scheduledArrival": 46560},
        ],
    }
    now = _local("2026-08-20T20:43:00")
    assert seconds_into_service_day(trip, now) == 20 * 3600 + 43 * 60
