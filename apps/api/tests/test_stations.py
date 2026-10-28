import json

import fakeredis
import httpx
import respx

from api.core.redis import add_key
from api.services.live_trips import build_live_trip_index, match_live_trip
from api.services.station_index import index_key, rail_stations_from_otp
from tests.upstream import graphql_route, load_fixture, otp_responder

KELENFOLD = "005501024"
KELETI = "005510017"
BOARDS = {
    (f"1:{KELENFOLD}", "departures"): "otp-board-kelenfold-departures.json",
    (f"1:{KELETI}", "arrivals"): "otp-board-keleti-arrivals.json",
}


async def _store_live_trains(
    redis: fakeredis.FakeAsyncRedis, trains: list[dict[str, object]]
) -> None:
    await redis.hset(  # type: ignore[misc]
        add_key("train-positions-hash"),
        mapping={str(t["vehicleId"]): json.dumps(t) for t in trains},
    )


# Station index


def test_index_keeps_rail_parent_stations_only() -> None:
    stations = load_fixture("otp-stations.json")["data"]["stations"]

    rows = rail_stations_from_otp(stations)
    ids = {row[0] for row in rows}

    # One entry per station, keyed by UIC code; platforms are not stations
    assert KELENFOLD in ids
    assert "003609142" in ids  # Szentendre H (HÉV)
    assert "005515529" in ids  # Győrtelek has no vehicle mode but is rail
    # Rail replacement bus stops, BKK and regional bus stations are dropped
    assert not any(row[1].endswith("/vá.") for row in rows)
    assert not any("," in row[1] for row in rows)
    assert "Kelenföld vasútállomás" not in {row[1] for row in rows}
    assert all(row[0].isdigit() for row in rows)


async def test_search_is_accent_insensitive_and_ranked(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder())

    response = await client.get("/v1/stations", params={"q": "gyor"})

    assert response.status_code == 200
    assert [s["name"] for s in response.json()] == [
        "Győr",  # exact
        "Győrvár",  # prefix, shortest first
        "Győrtelek",
        "Győrszentiván",
        "Győr-Gyárváros",
        "Győrtelek alsó",
        "Balatongyörök",  # substring last
    ]
    assert response.json()[0] == {
        "id": "005501289",
        "name": "Győr",
        "lat": 47.681944,
        "lon": 17.634722,
    }


async def test_search_matches_words_and_case(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder())

    async def search(**params: str | int) -> list[dict[str, object]]:
        response = await client.get("/v1/stations", params=params)
        result: list[dict[str, object]] = response.json()
        return result

    keleti = await search(q="KELETI")
    kelenfold = await search(q="kelenföld")
    limited = await search(q="győr", limit=2)

    assert [s["id"] for s in keleti] == [KELETI]
    assert [s["id"] for s in kelenfold] == [KELENFOLD]
    assert [s["name"] for s in limited] == ["Győr", "Győrvár"]


async def test_search_builds_index_once(
    client: httpx.AsyncClient,
    otp: respx.MockRouter,
    redis: fakeredis.FakeAsyncRedis,
) -> None:
    route = graphql_route(otp).mock(side_effect=otp_responder())

    await client.get("/v1/stations", params={"q": "gyor"})
    await client.get("/v1/stations", params={"q": "keleti"})

    assert route.call_count == 1
    assert await redis.ttl(index_key()) > 0


async def test_search_upstream_error_is_502(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    graphql_route(otp).mock(return_value=httpx.Response(503, text="maintenance"))

    response = await client.get("/v1/stations", params={"q": "gyor"})

    assert response.status_code == 502
    assert "unavailable" in response.json()["detail"]


# Boards


async def test_departures_merge_platforms_sorted_by_expected_time(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder(BOARDS))

    response = await client.get(
        f"/v1/stations/{KELENFOLD}/departures", params={"limit": 10}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["station"]["name"] == "Budapest-Kelenföld"
    assert body["kind"] == "departures"
    entries = body["entries"]
    expected = [e["expectedTime"] for e in entries]
    assert expected == sorted(expected)
    # Platforms 2, 4, 5, 10 and 14 plus rows without a platform
    assert {e["platform"] for e in entries} == {None, "2", "4", "5", "10", "14"}
    # Tomorrow's early trains come after tonight's late ones
    assert [e["serviceDate"] for e in entries[-3:]] == ["2026-10-29"] * 3

    # 341 and both 201s are all expected at 22:28; ties go by schedule
    assert [e["tripId"] for e in entries[:3]] == [
        "1:36231459",
        "1:36242192",
        "1:36226757",
    ]
    eurocity = entries[2]
    assert eurocity["tripShortName"] == "341 SEMMELWEIS IGNÁC EuroCity"
    assert eurocity["headsign"] == "Budapest-Keleti"
    assert eurocity["scheduledTime"] == 1793142000 + 80280
    assert eurocity["expectedTime"] == 1793142000 + 80880
    assert eurocity["delayMinutes"] == 10
    assert eurocity["delaySource"] == "otp"
    assert eurocity["realtime"] is True
    assert eurocity["vehicleId"] is None
    assert eurocity["routeShortName"].startswith('<span class="MNR2007">')


async def test_gps_delay_replaces_otp_delay_for_live_trains(
    client: httpx.AsyncClient,
    otp: respx.MockRouter,
    redis: fakeredis.FakeAsyncRedis,
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder(BOARDS))
    await _store_live_trains(redis, load_fixture("live-trains-kelenfold.json"))

    response = await client.get(
        f"/v1/stations/{KELENFOLD}/departures", params={"limit": 10}
    )

    by_trip = {e["tripId"]: e for e in response.json()["entries"]}
    intercity = by_trip["1:36231459"]  # 201 InterCity, live on the map
    assert intercity["delaySource"] == "gps"
    assert intercity["delayMinutes"] == 9  # OTP says 11
    assert intercity["vehicleId"] == "1:915506300507"
    assert intercity["expectedTime"] == intercity["scheduledTime"] + 9 * 60

    # Same train number, different trip: not live, keeps the OTP delay
    express = by_trip["1:36242192"]
    assert express["tripShortName"] == "201 AGRAM - TÓPART gyorsvonat"
    assert express["delaySource"] == "otp"
    assert express["delayMinutes"] == 11
    assert express["vehicleId"] is None

    assert by_trip["1:36017958"]["delaySource"] == "otp"  # 4758, not live

    trips = [e["tripShortName"].split()[0] for e in response.json()["entries"]]
    assert trips[:3] == ["341", "201", "201"]


async def test_gps_delay_never_moves_departures_earlier(
    client: httpx.AsyncClient,
    otp: respx.MockRouter,
    redis: fakeredis.FakeAsyncRedis,
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder(BOARDS))
    live = load_fixture("live-trains-kelenfold.json")
    for train in live:
        train["delay"] = -15
    await _store_live_trains(redis, live)

    response = await client.get(f"/v1/stations/{KELENFOLD}/departures")

    for entry in response.json()["entries"]:
        if entry["delaySource"] == "gps":
            assert entry["delayMinutes"] == 0
            assert entry["expectedTime"] == entry["scheduledTime"]


def test_live_trip_matching_prefers_gtfs_id() -> None:
    live = [
        {
            "vehicleId": "veh-a",
            "delay": 4,
            "trip": {
                "gtfsId": "1:111",
                "serviceDate": "2026-10-28",
                "tripShortName": "999 személyvonat",
                "stoptimes": [{"scheduledDeparture": 100}],
            },
        },
        # Two live trains sharing the fallback key are never matched by it
        *[
            {
                "vehicleId": f"veh-{n}",
                "delay": 1,
                "trip": {
                    "serviceDate": "2026-10-28",
                    "tripShortName": "555 személyvonat",
                    "stoptimes": [{"scheduledDeparture": 200}],
                },
            }
            for n in ("b", "c")
        ],
    ]
    index = build_live_trip_index(live)

    by_id = match_live_trip(index, "1:111", "2026-10-28", "other name", None)
    ambiguous = match_live_trip(index, "1:222", "2026-10-28", "555 személyvonat", 200)

    assert by_id is not None
    assert (by_id.vehicleId, by_id.delay) == ("veh-a", 4)
    assert ambiguous is None


async def test_arrivals_skip_originating_trains_and_show_origin(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder(BOARDS))

    response = await client.get(
        f"/v1/stations/{KELETI}/departures", params={"kind": "arrivals"}
    )

    assert response.status_code == 200
    entries = response.json()["entries"]
    names = [e["tripShortName"] for e in entries]
    assert "3078 MÁTRA InterRégió" not in names  # departs from Keleti
    assert "10 TRANSCARPATHIA gyorsvonat" not in names
    assert len(entries) == 6
    railjet = next(e for e in entries if e["tripId"] == "1:36226161")
    assert railjet["headsign"] == "Zürich HB"
    assert railjet["scheduledTime"] == 1793142000 + 77700
    assert railjet["delayMinutes"] == 54


async def test_board_is_cached(
    client: httpx.AsyncClient,
    otp: respx.MockRouter,
    redis: fakeredis.FakeAsyncRedis,
) -> None:
    route = graphql_route(otp).mock(side_effect=otp_responder(BOARDS))

    url = f"/v1/stations/{KELENFOLD}/departures"
    first = await client.get(url, params={"limit": 5})
    second = await client.get(url, params={"limit": 5})

    assert route.call_count == 1
    assert first.json() == second.json()
    key = add_key(f"station-board:{KELENFOLD}:departures:5")
    assert 0 < await redis.ttl(key) <= 30


async def test_quiet_station_widens_time_range(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    route = graphql_route(otp).mock(side_effect=otp_responder(BOARDS))

    await client.get(f"/v1/stations/{KELENFOLD}/departures", params={"limit": 20})

    ranges = [json.loads(c.request.content)["variables"]["range"] for c in route.calls]
    assert ranges == [4 * 3600, 24 * 3600]


async def test_unknown_station_is_404(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    route = graphql_route(otp).mock(side_effect=otp_responder(BOARDS))

    unknown = await client.get("/v1/stations/005599999/departures")
    malformed = await client.get("/v1/stations/not-a-uic/departures")

    assert unknown.status_code == 404
    assert malformed.status_code == 404
    assert route.call_count == 1  # malformed ids never reach upstream


async def test_board_graphql_error_is_502(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    graphql_route(otp).mock(
        return_value=httpx.Response(
            200, json={"errors": [{"message": "Validation error"}], "data": None}
        )
    )

    response = await client.get(f"/v1/stations/{KELENFOLD}/departures")

    assert response.status_code == 502
    assert response.json() == {"detail": "Upstream timetable service returned an error"}
