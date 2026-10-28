import json
from typing import Any

import fakeredis
import httpx
import pytest
import respx

from api.core.redis import add_key
from api.services.journeys import _itinerary
from tests.upstream import graphql_route, load_fixture, otp_responder

KELETI = "005510017"
DEBRECEN = "005513912"
GYOR = "005501289"
PECS = "005507294"
KELENFOLD = "005501024"
SZOLNOK = "005513748"

# Captured overnight, so nothing ran in realtime; the 568 leg of the Keleti ->
# Debrecen fixture was edited to run 4 min late (6 min at Debrecen) per OTP.
JOURNEYS = {
    (f"1:{KELETI}", f"1:{DEBRECEN}", False): "otp-journeys-keleti-debrecen.json",
    (f"1:{KELETI}", f"1:{DEBRECEN}", True): "otp-journeys-keleti-debrecen-arrive.json",
    (f"1:{GYOR}", f"1:{PECS}", False): "otp-journeys-gyor-pecs.json",
}

# 2026-10-29 15:05 CET
DEPARTURE_79 = 1793282700


async def _plan(client: httpx.AsyncClient, **params: Any) -> httpx.Response:
    params.setdefault("from", KELETI)
    params.setdefault("to", DEBRECEN)
    params.setdefault("time", "2026-10-29T15:00")
    return await client.get("/v1/journeys", params=params)


def _plan_requests(route: respx.Route) -> list[dict[str, Any]]:
    bodies = [json.loads(call.request.content) for call in route.calls]
    return [b["variables"] for b in bodies if "query Journeys" in b["query"]]


async def _store_live_trains(
    redis: fakeredis.FakeAsyncRedis, trains: list[dict[str, Any]]
) -> None:
    await redis.hset(  # type: ignore[misc]
        add_key("train-positions-hash"),
        mapping={str(t["vehicleId"]): json.dumps(t) for t in trains},
    )


async def test_legs_are_mapped_and_duplicates_merged(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    route = graphql_route(otp).mock(side_effect=otp_responder(journeys=JOURNEYS))

    response = await _plan(client)

    assert response.status_code == 200
    body = response.json()
    assert body["fromStation"]["name"] == "Budapest-Keleti"
    assert body["toStation"]["name"] == "Debrecen"
    assert body["time"] == DEPARTURE_79 - 5 * 60
    assert body["arriveBy"] is False
    # Local time is sent upstream; more itineraries are asked for than shown
    # since OTP spends many on duplicates
    assert _plan_requests(route) == [
        {
            "from": f"1:{KELETI}",
            "to": f"1:{DEBRECEN}",
            "date": "2026-10-29",
            "time": "15:00",
            "arriveBy": False,
            "n": 10,
        }
    ]

    # Seven upstream itineraries: four combinations of 79 (InterCity and
    # gyorsvonat) with 638/606 (portions of one train), 7406 twice, and 568
    itineraries = body["itineraries"]
    assert [[leg["trainNumber"] for leg in i["legs"]] for i in itineraries] == [
        ["79", "638"],
        ["568"],
        ["7406", "658"],
    ]

    first = itineraries[0]
    assert first["scheduledDeparture"] == DEPARTURE_79
    assert first["durationMinutes"] == 170
    assert first["transferCount"] == 1
    ic, connection = first["legs"]
    assert ic == {
        "type": "transit",
        "mode": "RAIL",
        "tripId": "1:36166503",
        "tripShortName": "79 MUNTENIA InterCity",
        "trainNumber": "79",
        "routeShortName": '<span class="MNR2007">&#474;</span>',
        "routeLongName": "IC MUNTENIA/TRAIANUS",
        "routeTextColor": "274F96",
        "headsign": "Bucureşti Nord",
        "serviceDate": "2026-10-29",
        "fromStop": {
            "id": KELETI,
            "name": "Budapest-Keleti",
            "lat": 47.500278,
            "lon": 19.084167,
            "platform": "1",
        },
        "toStop": {
            "id": SZOLNOK,
            "name": "Szolnok",
            "lat": 47.179167,
            "lon": 20.175833,
            "platform": "10",
        },
        "scheduledDeparture": DEPARTURE_79,
        "expectedDeparture": DEPARTURE_79,
        "scheduledArrival": DEPARTURE_79 + 82 * 60,
        "expectedArrival": DEPARTURE_79 + 82 * 60,
        "delayMinutes": 0,
        "delaySource": "otp",
        "realtime": False,
        "canceled": False,
        "intermediateStops": 0,
        "vehicleId": None,
    }
    assert connection["fromStop"]["platform"] == "4"
    assert connection["toStop"]["id"] == DEBRECEN
    assert connection["intermediateStops"] == 2


async def test_otp_delays_when_the_train_is_not_live(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder(journeys=JOURNEYS))

    response = await _plan(client)

    direct = response.json()["itineraries"][1]
    (leg,) = direct["legs"]
    assert leg["tripShortName"] == "568 TOKAJ InterCity"
    assert leg["delayMinutes"] == 4
    assert leg["delaySource"] == "otp"
    assert leg["realtime"] is True
    assert leg["expectedDeparture"] == leg["scheduledDeparture"] + 4 * 60
    assert leg["expectedArrival"] == leg["scheduledArrival"] + 6 * 60
    assert direct["expectedDeparture"] == leg["expectedDeparture"]
    assert direct["expectedArrival"] == leg["expectedArrival"]
    assert direct["transferCount"] == 0
    assert direct["transfers"] == []


async def test_gps_delay_wins_and_picks_the_live_duplicate(
    client: httpx.AsyncClient,
    otp: respx.MockRouter,
    redis: fakeredis.FakeAsyncRedis,
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder(journeys=JOURNEYS))
    # Train 79 runs on the map as the gyorsvonat listing, 7 min late
    await _store_live_trains(
        redis,
        [{"vehicleId": "1:915504800123", "delay": 7, "trip": {"gtfsId": "1:36463704"}}],
    )

    response = await _plan(client)

    first = response.json()["itineraries"][0]
    live, connection = first["legs"]
    assert live["tripId"] == "1:36463704"
    assert live["tripShortName"] == "79 MUNTENIA gyorsvonat"
    assert live["delaySource"] == "gps"
    assert live["delayMinutes"] == 7
    assert live["vehicleId"] == "1:915504800123"
    assert live["realtime"] is True
    assert live["expectedDeparture"] == DEPARTURE_79 + 7 * 60
    assert live["expectedArrival"] == live["scheduledArrival"] + 7 * 60
    assert first["expectedDeparture"] == DEPARTURE_79 + 7 * 60
    assert connection["delaySource"] == "otp"

    # 9 minutes planned at Szolnok, 2 left with the delay
    assert first["transfers"] == [
        {
            "fromLeg": 0,
            "toLeg": 1,
            "station": "Szolnok",
            "transferMinutes": 9,
            "expectedTransferMinutes": 2,
            "missRisk": None,
        }
    ]


async def test_gps_delay_never_moves_departures_earlier(
    client: httpx.AsyncClient,
    otp: respx.MockRouter,
    redis: fakeredis.FakeAsyncRedis,
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder(journeys=JOURNEYS))
    await _store_live_trains(
        redis,
        [{"vehicleId": "1:1", "delay": -3, "trip": {"gtfsId": "1:36166503"}}],
    )

    response = await _plan(client)

    leg = response.json()["itineraries"][0]["legs"][0]
    assert leg["delaySource"] == "gps"
    assert leg["delayMinutes"] == 0
    assert leg["expectedDeparture"] == leg["scheduledDeparture"]
    assert leg["expectedArrival"] == leg["scheduledArrival"] - 3 * 60


async def test_transfer_minutes_and_ticket_url(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder(journeys=JOURNEYS))

    response = await _plan(
        client, **{"from": GYOR, "to": PECS, "time": "2026-10-29T07:00"}
    )

    assert response.status_code == 200
    first = response.json()["itineraries"][0]
    assert [leg["tripShortName"] for leg in first["legs"]] == [
        "927 SAVARIA InterCity",
        "812 MECSEK InterCity",
    ]
    assert first["transfers"] == [
        {
            "fromLeg": 0,
            "toLeg": 1,
            "station": "Budapest-Kelenföld",
            "transferMinutes": 35,
            "expectedTransferMinutes": 35,
            "missRisk": None,
        }
    ]
    # From the first train's boarding station to the last one's destination,
    # at the first departure (08:21 CET)
    assert first["ticketUrl"] == (
        "https://jegy.mav.hu/"
        f"?from_ticketing_stop_time_id=%5B%22{GYOR}%22%5D"
        f"&to_ticketing_stop_time_id=%5B%22{PECS}%22%5D"
        "&boarding_time=%5B%222026-10-29T07%3A21%3A00.000Z%22%5D"
        "&lang=hu"
    )


def test_walks_are_compact_and_count_towards_the_transfer() -> None:
    raw = load_fixture("otp-journeys-gyor-pecs.json")["data"]["plan"]["itineraries"][0]
    ride_in, ride_out = raw["legs"]
    # A 4-minute walk to another station before the second train
    walk = {
        "mode": "WALK",
        "startTime": ride_in["endTime"],
        "endTime": ride_in["endTime"] + 4 * 60 * 1000,
        "distance": 312.6,
        "from": ride_in["to"],
        "to": {"name": "Kelenföld vasútállomás", "lat": 47.4644, "lon": 19.0207},
        "trip": None,
    }
    raw["legs"] = [ride_in, walk, ride_out]

    itinerary = _itinerary(raw, {})

    assert itinerary is not None
    assert itinerary.legs[1].model_dump() == {
        "type": "walk",
        "fromStop": {
            "id": KELENFOLD,
            "name": "Budapest-Kelenföld",
            "lat": 47.464444,
            "lon": 19.02,
            "platform": "14",
        },
        "toStop": {
            "id": None,
            "name": "Kelenföld vasútállomás",
            "lat": 47.4644,
            "lon": 19.0207,
            "platform": None,
        },
        "departureTime": ride_in["endTime"] // 1000,
        "arrivalTime": ride_in["endTime"] // 1000 + 4 * 60,
        "distanceMeters": 313,
    }
    (transfer,) = itinerary.transfers
    assert (transfer.fromLeg, transfer.toLeg) == (0, 2)
    assert transfer.transferMinutes == 35


def test_staying_aboard_is_not_a_transfer() -> None:
    raw = load_fixture("otp-journeys-gyor-pecs.json")["data"]["plan"]["itineraries"][0]
    raw["legs"][1]["interlineWithPreviousLeg"] = True

    itinerary = _itinerary(raw, {})

    assert itinerary is not None
    assert itinerary.transferCount == 0
    assert itinerary.transfers == []


async def test_arrive_by_keeps_the_latest_arrivals(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    route = graphql_route(otp).mock(side_effect=otp_responder(journeys=JOURNEYS))

    response = await _plan(
        client, time="2026-10-30T12:00:00+01:00", arriveBy="true", limit=3
    )

    assert response.status_code == 200
    body = response.json()
    assert body["arriveBy"] is True
    assert _plan_requests(route)[0] | {"n": None} == {
        "from": f"1:{KELETI}",
        "to": f"1:{DEBRECEN}",
        "date": "2026-10-30",
        "time": "12:00",
        "arriveBy": True,
        "n": None,
    }
    # The three arriving last before noon, in departure order
    itineraries = body["itineraries"]
    assert [i["legs"][0]["trainNumber"] for i in itineraries] == ["560", "7402", "75"]
    assert all(i["scheduledArrival"] <= body["time"] for i in itineraries)


async def test_utc_times_are_planned_in_local_time(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    route = graphql_route(otp).mock(side_effect=otp_responder(journeys=JOURNEYS))

    await _plan(client, time="2026-10-29T14:00:59Z")

    (request,) = _plan_requests(route)
    assert (request["date"], request["time"]) == ("2026-10-29", "15:00")


async def test_plans_are_cached_per_minute(
    client: httpx.AsyncClient,
    otp: respx.MockRouter,
    redis: fakeredis.FakeAsyncRedis,
) -> None:
    route = graphql_route(otp).mock(side_effect=otp_responder(journeys=JOURNEYS))

    first = await _plan(client, time="2026-10-29T15:00:10")
    again = await _plan(client, time="2026-10-29T15:00:50")
    await _plan(client, time="2026-10-29T15:01")
    await _plan(client, time="2026-10-29T15:00", arriveBy="true")

    assert again.json() == first.json()
    assert len(_plan_requests(route)) == 3
    keys = await redis.keys(add_key("journeys:*"))
    assert len(keys) == 3
    assert 0 < await redis.ttl(keys[0]) <= 60


async def test_no_connection_is_an_empty_list(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder(journeys=JOURNEYS))

    response = await _plan(client, to=PECS)

    assert response.status_code == 200
    assert response.json()["itineraries"] == []


@pytest.mark.parametrize(
    ("params", "status"),
    [
        ({"to": "005599999"}, 404),
        ({"from": "1:005510017"}, 404),
        ({"to": KELETI}, 422),
        ({"limit": 0}, 422),
        ({"time": "tomorrow"}, 422),
    ],
)
async def test_invalid_requests(
    client: httpx.AsyncClient,
    otp: respx.MockRouter,
    params: dict[str, Any],
    status: int,
) -> None:
    route = graphql_route(otp).mock(side_effect=otp_responder(journeys=JOURNEYS))

    response = await _plan(client, **params)

    assert response.status_code == status
    assert _plan_requests(route) == []


async def test_upstream_error_is_502(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    respond = otp_responder(journeys=JOURNEYS)

    def failing_plan(request: httpx.Request) -> httpx.Response:
        if b"query Journeys" in request.content:
            return httpx.Response(200, json={"errors": [{"message": "boom"}]})
        return respond(request)

    graphql_route(otp).mock(side_effect=failing_plan)

    response = await _plan(client)

    assert response.status_code == 502
