import json
from dataclasses import dataclass
from datetime import date
from typing import Any

import fakeredis

from api.core.redis import add_key
from api.services.commute import find_commute_trip, resolve_commute_trip, train_number

MONDAY = date(2026, 10, 26)
TUESDAY = date(2026, 10, 27)
WEEKDAYS = 0b0011111

KELETI = "005510017"
SZOLNOK = "005510033"
CEGLED = "005510090"
GYOR = "005501263"


@dataclass
class Commute:
    trip_short_name: str
    weekdays: int | None
    from_station_id: str | None
    to_station_id: str | None = None


def location(
    trip_id: str,
    name: str,
    stops: list[tuple[str, int]],
    service_date: date = MONDAY,
    vehicle_id: str | None = None,
    delay: int = 3,
) -> dict[str, Any]:
    """A processed live position; stops are (UIC station code, departure s)."""
    return {
        "vehicleId": vehicle_id or f"veh-{trip_id}",
        "delay": delay,
        "trip": {
            "gtfsId": trip_id,
            "serviceDate": service_date.isoformat(),
            "tripShortName": name,
            "stoptimes": [
                {
                    "scheduledArrival": t,
                    "scheduledDeparture": t,
                    "stop": {
                        "gtfsId": f"1:{station}_{i + 1}",
                        "platformCode": str(i + 1),
                    },
                }
                for i, (station, t) in enumerate(stops)
            ],
        },
    }


def test_train_number() -> None:
    assert train_number("559 AGRIA InterRégió") == "559"
    assert train_number("H4117 HÉV") == "h4117"
    assert train_number("  ") == ""


def test_resolves_live_trip() -> None:
    locs = [
        location(
            "1:a", "600 NYÍRSÉG InterCity", [(KELETI, 7 * 3600), (CEGLED, 8 * 3600)]
        ),
        location("1:b", "6140 személyvonat", [(SZOLNOK, 9 * 3600)]),
    ]
    resolved = find_commute_trip(locs, Commute("600", WEEKDAYS, KELETI), MONDAY)
    assert resolved is not None
    assert resolved.tripId == "1:a"
    assert resolved.vehicleId == "veh-1:a"
    assert resolved.fromStopId == f"1:{KELETI}_1"
    assert resolved.platform == "1"
    assert resolved.scheduledDepartureS == 7 * 3600
    assert resolved.delayMin == 3


def test_duplicate_train_numbers_pick_the_one_at_boarding_station() -> None:
    # Two different trips run as 4277 the same day on different lines
    locs = [
        location("1:west", "4277 személyvonat", [(GYOR, 6 * 3600)]),
        location("1:east", "4277 személyvonat", [(SZOLNOK, 18 * 3600)]),
    ]
    east = find_commute_trip(locs, Commute("4277", WEEKDAYS, SZOLNOK), MONDAY)
    west = find_commute_trip(locs, Commute("4277", WEEKDAYS, GYOR), MONDAY)
    assert east is not None
    assert east.tripId == "1:east"
    assert west is not None
    assert west.tripId == "1:west"


def test_duplicate_train_numbers_at_same_station_use_destination() -> None:
    # Same number in both directions through Cegléd
    locs = [
        location("1:out", "8212", [(KELETI, 3600), (CEGLED, 7200), (SZOLNOK, 9000)]),
        location("1:back", "8212", [(SZOLNOK, 3600), (CEGLED, 5400), (KELETI, 9000)]),
    ]
    outbound = find_commute_trip(
        locs, Commute("8212", WEEKDAYS, CEGLED, SZOLNOK), MONDAY
    )
    inbound = find_commute_trip(locs, Commute("8212", WEEKDAYS, CEGLED, KELETI), MONDAY)
    assert outbound is not None
    assert outbound.tripId == "1:out"
    assert inbound is not None
    assert inbound.tripId == "1:back"
    # Without a destination the earlier departure from Cegléd wins
    either = find_commute_trip(locs, Commute("8212", WEEKDAYS, CEGLED), MONDAY)
    assert either is not None
    assert either.tripId == "1:back"


def test_destination_before_boarding_station_does_not_match() -> None:
    locs = [location("1:a", "600", [(KELETI, 3600), (CEGLED, 7200)])]
    assert (
        find_commute_trip(locs, Commute("600", WEEKDAYS, CEGLED, KELETI), MONDAY)
        is None
    )


def test_train_not_running() -> None:
    locs = [location("1:a", "600", [(KELETI, 3600)])]
    # Different number
    assert find_commute_trip(locs, Commute("601", WEEKDAYS, KELETI), MONDAY) is None
    # Not live at all
    assert find_commute_trip([], Commute("600", WEEKDAYS, KELETI), MONDAY) is None
    # Doesn't stop at the boarding station
    assert find_commute_trip(locs, Commute("600", WEEKDAYS, GYOR), MONDAY) is None
    # Live trip belongs to another day
    assert find_commute_trip(locs, Commute("600", WEEKDAYS, KELETI), TUESDAY) is None
    # Commute is not taken on that weekday
    saturday = date(2026, 10, 31)
    locs_sat = [location("1:a", "600", [(KELETI, 3600)], service_date=saturday)]
    assert (
        find_commute_trip(locs_sat, Commute("600", WEEKDAYS, KELETI), saturday) is None
    )


def test_past_midnight_resolves_on_calendar_day_of_departure() -> None:
    # Service date Monday, leaves Keleti 23:50 and Cegléd 00:40 on Tuesday
    locs = [
        location(
            "1:night",
            "1919 éjszakai",
            [(KELETI, 23 * 3600 + 50 * 60), (CEGLED, 24 * 3600 + 40 * 60)],
            service_date=MONDAY,
        )
    ]
    tuesday_only = 1 << (TUESDAY.isoweekday() - 1)
    from_cegled = find_commute_trip(
        locs, Commute("1919", tuesday_only, CEGLED), TUESDAY
    )
    assert from_cegled is not None
    assert from_cegled.serviceDate == MONDAY
    assert from_cegled.scheduledDepartureS == 24 * 3600 + 40 * 60
    assert (
        find_commute_trip(locs, Commute("1919", tuesday_only, CEGLED), MONDAY) is None
    )

    monday_only = 1 << (MONDAY.isoweekday() - 1)
    from_keleti = find_commute_trip(locs, Commute("1919", monday_only, KELETI), MONDAY)
    assert from_keleti is not None
    assert (
        find_commute_trip(locs, Commute("1919", monday_only, KELETI), TUESDAY) is None
    )


def test_past_midnight_tie_break_uses_actual_departure() -> None:
    # Two live 1919s leave Cegléd on Tuesday: 00:40 (Monday's) and 00:20
    locs = [
        location("1:mon", "1919", [(CEGLED, 24 * 3600 + 40 * 60)], service_date=MONDAY),
        location("1:tue", "1919", [(CEGLED, 20 * 60)], service_date=TUESDAY),
    ]
    resolved = find_commute_trip(locs, Commute("1919", WEEKDAYS, CEGLED), TUESDAY)
    assert resolved is not None
    assert resolved.tripId == "1:tue"


async def test_resolve_reads_live_positions_from_redis() -> None:
    redis = fakeredis.FakeAsyncRedis(decode_responses=True)
    loc = location("1:a", "600 NYÍRSÉG InterCity", [(KELETI, 3600)])
    await redis.hset(  # type: ignore[misc]
        add_key("train-positions-hash"), mapping={loc["vehicleId"]: json.dumps(loc)}
    )
    resolved = await resolve_commute_trip(
        redis, Commute("600", WEEKDAYS, KELETI), MONDAY
    )
    assert resolved is not None
    assert resolved.tripId == "1:a"

    await redis.delete(add_key("train-positions-hash"))
    assert (
        await resolve_commute_trip(redis, Commute("600", WEEKDAYS, KELETI), MONDAY)
        is None
    )
    await redis.aclose()
