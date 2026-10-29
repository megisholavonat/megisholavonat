"""Journeys with Budapest public transport, and from or to any Budapest station."""

import copy
import json
from typing import Any

import httpx
import pytest
import respx

from api.schemas.journeys import CityLeg, TransitLeg, WalkLeg
from api.services.journeys import (
    _itinerary,
    drop_detours_within_budapest,
    merge_duplicate_itineraries,
)
from tests.upstream import graphql_route, load_fixture, otp_responder

KELETI = "005510017"
DELI = "005501016"
KELENFOLD = "005501024"
ZUGLO = "005510090"
SZEGED = "005517228"
VAC = "005510447"
GYOR = "005501289"
BUDAORS = "005501032"
GOMORI = "005512674"
TISZAI = "005511387"
CENTRE = "Budapest::47.497912,19.054916"

# Captured for Fri 2026-10-30 07:00 with city transit on
JOURNEYS = {
    (f"1:{KELETI}", f"1:{SZEGED}", False): "otp-journeys-city-keleti-szeged.json",
    (f"1:{DELI}", f"1:{VAC}", False): "otp-journeys-city-deli-vac.json",
    (CENTRE, f"1:{GYOR}", False): "otp-journeys-city-budapest-gyor.json",
    (f"1:{KELENFOLD}", f"1:{BUDAORS}", False): (
        "otp-journeys-city-kelenfold-budaors.json"
    ),
    (f"1:{GOMORI}", f"1:{KELETI}", False): "otp-journeys-city-gomori-keleti.json",
}

CITY_MODES = [
    {"mode": mode}
    for mode in (
        "RAIL",
        "SUBURBAN_RAILWAY",
        "TRAMTRAIN",
        "RAIL_REPLACEMENT_BUS",
        "SUBWAY",
        "TRAM",
        "BUS",
        "TROLLEYBUS",
        "WALK",
    )
]


async def _plan(client: httpx.AsyncClient, **params: Any) -> httpx.Response:
    params.setdefault("time", "2026-10-30T07:00")
    params.setdefault("cityTransit", "true")
    return await client.get("/v1/journeys", params=params)


def _plan_requests(route: respx.Route) -> list[dict[str, Any]]:
    bodies = [json.loads(call.request.content) for call in route.calls]
    return [b["variables"] for b in bodies if "query Journeys" in b["query"]]


def _chain(itinerary: dict[str, Any]) -> list[str]:
    """Lines and train numbers, walks left out."""
    return [
        leg["line"] if leg["type"] == "city" else leg["trainNumber"]
        for leg in itinerary["legs"]
        if leg["type"] != "walk"
    ]


def _raw(fixture: str) -> list[dict[str, Any]]:
    itineraries: list[dict[str, Any]] = load_fixture(fixture)["data"]["plan"][
        "itineraries"
    ]
    return itineraries


async def test_city_transit_reaches_a_better_station(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    route = graphql_route(otp).mock(side_effect=otp_responder(journeys=JOURNEYS))

    response = await _plan(client, **{"from": KELETI, "to": SZEGED, "limit": 4})

    assert response.status_code == 200
    (request,) = _plan_requests(route)
    assert request["modes"] == CITY_MODES
    # More itineraries are spent on ways of reaching the same trains
    assert request["n"] == 12
    itineraries = response.json()["itineraries"]
    # Bus to Zugló for the Szeged InterCity, one itinerary per train: its
    # InterCity and gyorsvonat listings, and the ways to reach it, are merged
    assert [_chain(i) for i in itineraries] == [
        ["8E", "712"],
        ["133E", "722"],
        ["8E", "732"],
        ["5", "704"],
    ]
    first = itineraries[0]
    assert first["durationMinutes"] == 163
    assert first["transferCount"] == 0
    walk, bus, walk_to_train, train = first["legs"]
    assert walk["type"] == walk_to_train["type"] == "walk"
    assert bus == {
        "type": "city",
        "mode": "BUS",
        "line": "8E",
        "routeColor": "009EE3",
        "routeTextColor": "FFFFFF",
        "headsign": "Újpalota, Nyírpalota út",
        "fromStop": {
            "id": None,
            "name": "Budapest, Keleti pályaudvar M",
            "lat": 47.500466,
            "lon": 19.081955,
            "platform": None,
        },
        "toStop": {
            "id": None,
            "name": "Budapest, Zugló vasútállomás",
            "lat": 47.511171,
            "lon": 19.098663,
            "platform": None,
        },
        "scheduledDeparture": 1793342100,
        "expectedDeparture": 1793342100,
        "scheduledArrival": 1793342400,
        "expectedArrival": 1793342400,
        "realtime": False,
        "intermediateStops": 0,
    }
    assert train["fromStop"]["id"] == ZUGLO
    # The journey starts with the walk to the bus
    assert first["scheduledDeparture"] == walk["departureTime"]
    # The ticket is for the train only, from Zugló
    assert f"%5B%22{ZUGLO}%22%5D" in first["ticketUrl"]
    assert f"%5B%22{SZEGED}%22%5D" in first["ticketUrl"]
    assert "2026-10-30T06%3A50%3A00.000Z" in first["ticketUrl"]


async def test_two_city_rides_to_the_train(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder(journeys=JOURNEYS))

    response = await _plan(client, **{"from": DELI, "to": VAC, "limit": 3})

    itineraries = response.json()["itineraries"]
    assert [_chain(i) for i in itineraries] == [
        ["221", "4-6", "174"],
        ["17", "4-6", "2442"],
        ["59", "4-6", "2342"],
    ]
    tram = itineraries[0]["legs"][3]
    assert (tram["mode"], tram["routeColor"], tram["routeTextColor"]) == (
        "TRAM",
        "FFD800",
        "000000",
    )
    assert itineraries[0]["durationMinutes"] == 56


async def test_journeys_without_a_train_are_dropped(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder(journeys=JOURNEYS))

    response = await _plan(client, **{"from": KELENFOLD, "to": BUDAORS})

    # Buses 40E, 172 and 173 run there too, but this is a train planner
    assert [_chain(i) for i in response.json()["itineraries"]] == [
        ["4412"],
        ["4922"],
        ["4422"],
    ]


async def test_rail_only_by_default(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    route = graphql_route(otp).mock(side_effect=otp_responder(journeys=JOURNEYS))

    await _plan(client, **{"from": KELETI, "to": SZEGED, "cityTransit": "false"})

    (request,) = _plan_requests(route)
    assert {m["mode"] for m in request["modes"]} == {
        "RAIL",
        "SUBURBAN_RAILWAY",
        "TRAMTRAIN",
        "RAIL_REPLACEMENT_BUS",
        "WALK",
    }
    assert request["n"] == 10


async def test_any_budapest_station_starts_at_the_train(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    route = graphql_route(otp).mock(side_effect=otp_responder(journeys=JOURNEYS))

    # City transit is implied
    response = await client.get(
        "/v1/journeys",
        params={"from": "budapest", "to": GYOR, "time": "2026-10-30T07:00"},
    )

    assert response.status_code == 200
    (request,) = _plan_requests(route)
    # Planned from Deák Ferenc tér
    assert request["from"] == CENTRE
    assert request["modes"] == CITY_MODES
    body = response.json()
    assert body["fromStation"] == {
        "id": "budapest",
        "name": "Budapest",
        "lat": 47.497912,
        "lon": 19.054916,
    }
    itineraries = body["itineraries"]
    assert [_chain(i) for i in itineraries] == [
        ["60"],
        ["354"],
        ["140"],
        ["992"],
        ["62"],
    ]
    # No metro from the city centre: the journey starts at the train
    for itinerary in itineraries:
        (train,) = itinerary["legs"]
        assert train["fromStop"]["id"] == KELENFOLD
        assert itinerary["scheduledDeparture"] == train["scheduledDeparture"]


@pytest.mark.parametrize(
    ("params", "status"),
    [
        ({"from": "budapest", "to": "budapest"}, 422),
        ({"from": "budapest", "to": ZUGLO}, 422),
        ({"from": KELETI, "to": "budapest"}, 422),
        ({"from": "budapest", "to": "005599999"}, 404),
    ],
)
async def test_any_budapest_station_needs_a_place_outside(
    client: httpx.AsyncClient,
    otp: respx.MockRouter,
    params: dict[str, Any],
    status: int,
) -> None:
    route = graphql_route(otp).mock(side_effect=otp_responder(journeys=JOURNEYS))

    response = await client.get("/v1/journeys", params=params)

    assert response.status_code == status
    assert _plan_requests(route) == []


# --- leg rules ---


def _with_route(leg: dict[str, Any], gtfs_id: str, mode: str) -> dict[str, Any]:
    leg = copy.deepcopy(leg)
    leg["mode"] = mode
    leg["route"] = {**(leg.get("route") or {}), "gtfsId": gtfs_id}
    return leg


def test_city_legs_come_from_urban_transit_only() -> None:
    raw = _raw("otp-journeys-city-keleti-szeged.json")[0]
    assert _itinerary(raw, {}) is not None

    # Another town's trolleybus is urban transit too
    trolleybus = copy.deepcopy(raw)
    trolleybus["legs"][1] = _with_route(raw["legs"][1], "debrecen:3", "TROLLEYBUS")
    assert _itinerary(trolleybus, {}) is not None

    # An interurban coach, a ferry or an unknown feed never is
    for feed in ("hkir:hkir_123", "bahart:1", "newfeed:1"):
        coach = copy.deepcopy(raw)
        coach["legs"][1] = _with_route(raw["legs"][1], feed, "BUS")
        assert _itinerary(coach, {}) is None


async def test_city_transit_outside_budapest(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder(journeys=JOURNEYS))

    response = await _plan(client, **{"from": GOMORI, "to": KELETI, "limit": 10})

    itineraries = response.json()["itineraries"]
    # Miskolc's bus 43 to Tiszai, besides the local trains there
    by_bus = [i for i in itineraries if i["legs"][1]["type"] == "city"]
    assert [_chain(i) for i in by_bus] == [["43", "650"]]
    bus = by_bus[0]["legs"][1]
    assert (bus["mode"], bus["routeColor"]) == ("BUS", "81C290")
    assert by_bus[0]["legs"][3]["fromStop"]["id"] == TISZAI
    assert f"%5B%22{TISZAI}%22%5D" in by_bus[0]["ticketUrl"]


def test_city_rides_only_at_the_ends_and_once_between_trains() -> None:
    walk_in, bus, walk_out, train = _raw("otp-journeys-city-keleti-szeged.json")[0][
        "legs"
    ]

    def itinerary(*legs: dict[str, Any]) -> Any:
        return _itinerary({"legs": list(legs)}, {})

    # Two rides to the train are fine, three are not
    assert itinerary(walk_in, bus, bus, walk_out, train) is not None
    assert itinerary(walk_in, bus, bus, bus, walk_out, train) is None
    # Before, between and after trains; but only one link between trains
    linked = itinerary(bus, train, bus, train, bus)
    assert linked is not None
    assert [type(leg) for leg in linked.legs] == [
        CityLeg,
        TransitLeg,
        CityLeg,
        TransitLeg,
        CityLeg,
    ]
    assert itinerary(train, bus, train, bus, train) is None
    # Not without a train
    assert itinerary(walk_in, bus, walk_out) is None


def test_a_city_link_counts_towards_the_transfer() -> None:
    walk_in, bus, walk_out, train = _raw("otp-journeys-city-keleti-szeged.json")[0][
        "legs"
    ]
    later = copy.deepcopy(train)
    later["startTime"] = train["endTime"] + 30 * 60 * 1000
    later["endTime"] = later["startTime"] + 60 * 60 * 1000

    linked = _itinerary({"legs": [train, walk_in, bus, walk_out, later]}, {})

    assert linked is not None
    (transfer,) = linked.transfers
    assert (transfer.fromLeg, transfer.toLeg) == (0, 4)
    assert transfer.transferMinutes == 30
    assert isinstance(linked.legs[1], WalkLeg)


def test_any_station_requires_a_budapest_train() -> None:
    raw = _raw("otp-journeys-city-budapest-gyor.json")[0]
    train = raw["legs"][-1]
    assert train["from"]["stop"]["stationUicPricingCode"] == KELENFOLD

    itinerary = _itinerary(raw, {}, from_any=True)
    assert itinerary is not None
    assert [type(leg) for leg in itinerary.legs] == [TransitLeg]

    # A bus out of town to a train there is not "any Budapest station"
    elsewhere = copy.deepcopy(raw)
    elsewhere["legs"][-1]["from"] = {
        "name": "Budaörs",
        "lat": 47.4475,
        "lon": 18.965,
        "stop": {"platformCode": None, "stationUicPricingCode": BUDAORS},
    }
    assert _itinerary(elsewhere, {}, from_any=True) is None


def test_detours_within_budapest_are_dropped() -> None:
    raw = _raw("otp-journeys-city-budapest-gyor.json")[0]
    railjet = raw["legs"][-1]
    # Déli -> Kelenföld by train for the railjet that starts there
    shuttle = copy.deepcopy(railjet)
    shuttle["trip"] = {**railjet["trip"], "gtfsId": "1:1", "tripShortName": "4622"}
    shuttle["startTime"] = railjet["startTime"] - 12 * 60 * 1000
    shuttle["endTime"] = railjet["startTime"] - 6 * 60 * 1000
    shuttle["from"] = {
        "name": "Budapest-Déli",
        "lat": 47.4989,
        "lon": 19.025,
        "stop": {"platformCode": "8", "stationUicPricingCode": DELI},
    }
    shuttle["to"] = railjet["from"]

    via_deli = _itinerary({"legs": [shuttle, railjet]}, {}, from_any=True)
    direct = _itinerary({"legs": [railjet]}, {}, from_any=True)
    assert via_deli is not None
    assert direct is not None

    assert drop_detours_within_budapest([via_deli, direct], True, False) == [direct]
    # Alone, it is still a way to go
    assert drop_detours_within_budapest([via_deli], True, False) == [via_deli]
    # From a chosen station, it is the way from there
    assert drop_detours_within_budapest([via_deli, direct], False, False) == [
        via_deli,
        direct,
    ]


def test_same_times_with_another_train_between_are_merged() -> None:
    # Szolnok -> Hatvan -> Eger; the copy changes at Füzesabony onto a train
    # under another number, at the same times overall
    raw = load_fixture("otp-journeys-szolnok-eger.json")["data"]["plan"]["itineraries"][
        0
    ]
    first, second = raw["legs"]
    other = copy.deepcopy(raw)
    other_first, other_second = other["legs"]
    other_first["to"] = other_second["from"] = {
        "name": "Füzesabony",
        "lat": 47.75,
        "lon": 20.41,
        "stop": {"platformCode": None, "stationUicPricingCode": "005512005"},
    }
    other_first["endTime"] = first["endTime"] + 40 * 60 * 1000
    other_second["startTime"] = other_first["endTime"] + 3 * 60 * 1000
    other_second["trip"] = {**second["trip"], "gtfsId": "1:2", "tripShortName": "3039"}

    via_hatvan, via_fuzesabony = (_itinerary(r, {}) for r in (raw, other))
    assert via_hatvan is not None
    assert via_fuzesabony is not None
    assert via_hatvan.scheduledArrival == via_fuzesabony.scheduledArrival

    # The longer change is kept
    assert via_hatvan.transfers[0].transferMinutes > 3
    merged = merge_duplicate_itineraries([via_fuzesabony, via_hatvan])
    assert merged == [via_hatvan]
