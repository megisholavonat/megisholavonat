import json
from typing import Any

import fakeredis
import httpx
import pytest
import respx

from api.core.redis import add_key
from api.schemas.stations import BoardEntry, BoardKind
from api.services.live_trips import build_live_trip_index, match_live_trip
from api.services.station_board import _board_entry, merge_duplicate_trips
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


def _board_calls(route: respx.Route) -> list[Any]:
    """Board queries only (a board also reads the alert feed, cached)."""
    return [c for c in route.calls if b"query StationBoard" in c.request.content]


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

    # OTP lists train 201 twice (InterCity and gyorsvonat): one row remains,
    # and it ties with 341 at 22:28, so schedule decides the order
    assert [e["tripShortName"].split()[0] for e in entries[:2]] == ["201", "341"]
    assert sum(e["tripShortName"].startswith("201 ") for e in entries) == 1
    eurocity = entries[1]
    assert eurocity["tripShortName"] == "341 SEMMELWEIS IGNÁC EuroCity"
    assert eurocity["headsign"] == "Budapest-Keleti"
    assert eurocity["scheduledTime"] == 1793142000 + 80280
    assert eurocity["expectedTime"] == 1793142000 + 80880
    assert eurocity["delayMinutes"] == 10
    assert eurocity["delaySource"] == "otp"
    assert eurocity["realtime"] is True
    assert eurocity["vehicleId"] is None
    assert eurocity["routeShortName"].startswith('<span class="MNR2007">')
    assert eurocity["reason"] is None


async def test_board_entries_carry_first_known_delay_reason(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder(BOARDS))

    response = await client.get(
        f"/v1/stations/{KELENFOLD}/departures", params={"limit": 10}
    )

    by_trip = {e["tripId"]: e for e in response.json()["entries"]}
    # A service notice first, then a known reason
    assert by_trip["1:36017936"]["reason"] == {
        "code": "dwell",
        "label": "Hosszú állás",
    }
    # Only a service notice
    assert by_trip["1:36017868"]["reason"] is None


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

    # The duplicate listing of train 201 is merged into the live one
    assert "1:36242192" not in by_trip

    assert by_trip["1:36017958"]["delaySource"] == "otp"  # 4758, not live

    trips = [e["tripShortName"].split()[0] for e in response.json()["entries"]]
    assert trips[:2] == ["341", "201"]
    assert trips.count("201") == 1


@pytest.mark.parametrize("activity", ["offRoute", "arrived", "cancelled"])
async def test_no_gps_delay_for_trains_the_map_shows_none_for(
    client: httpx.AsyncClient,
    otp: respx.MockRouter,
    redis: fakeredis.FakeAsyncRedis,
    activity: str,
) -> None:
    # QA n-C: 604 off its route read "+5" on the Szolnok board while the map
    # and the train sheet showed no delay
    graphql_route(otp).mock(side_effect=otp_responder(BOARDS))
    live = load_fixture("live-trains-kelenfold.json")
    for train in live:
        train["activity"] = activity
    await _store_live_trains(redis, live)

    response = await client.get(
        f"/v1/stations/{KELENFOLD}/departures", params={"limit": 10}
    )

    entries = response.json()["entries"]
    by_trip = {e["tripId"]: e for e in entries}
    intercity = by_trip["1:36231459"]  # 201 InterCity
    # As a row without a live train: OTP's realtime delay
    assert intercity["delaySource"] == "otp"
    assert intercity["delayMinutes"] == 11
    assert intercity["expectedTime"] == intercity["scheduledTime"] + 11 * 60
    # Still the train on the map, and still one row
    assert intercity["vehicleId"] == "1:915506300507"
    assert [e["tripShortName"].split()[0] for e in entries].count("201") == 1


async def test_running_and_waiting_trains_keep_their_gps_delay(
    client: httpx.AsyncClient,
    otp: respx.MockRouter,
    redis: fakeredis.FakeAsyncRedis,
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder(BOARDS))
    live = load_fixture("live-trains-kelenfold.json")
    live[0]["activity"] = "running"
    live[1]["activity"] = "beforeDeparture"
    await _store_live_trains(redis, live)

    response = await client.get(
        f"/v1/stations/{KELENFOLD}/departures", params={"limit": 10}
    )

    by_number = {e["tripShortName"].split()[0]: e for e in response.json()["entries"]}
    assert by_number["201"]["delaySource"] == "gps"
    assert by_number["201"]["delayMinutes"] == 9
    assert by_number["341"]["delaySource"] == "gps"


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

    assert len(_board_calls(route)) == 1
    assert first.json() == second.json()
    key = add_key(f"station-board:{KELENFOLD}:departures:5")
    assert 0 < await redis.ttl(key) <= 30


async def test_quiet_station_widens_time_range(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    route = graphql_route(otp).mock(side_effect=otp_responder(BOARDS))

    await client.get(f"/v1/stations/{KELENFOLD}/departures", params={"limit": 20})

    ranges = [
        json.loads(c.request.content)["variables"]["range"] for c in _board_calls(route)
    ]
    assert ranges == [4 * 3600, 24 * 3600]


async def test_unknown_station_is_404(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    route = graphql_route(otp).mock(side_effect=otp_responder(BOARDS))

    unknown = await client.get("/v1/stations/005599999/departures")
    malformed = await client.get("/v1/stations/not-a-uic/departures")

    assert unknown.status_code == 404
    assert malformed.status_code == 404
    assert len(_board_calls(route)) == 1  # malformed ids never reach upstream


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


def _entry(trip_id: str, name: str, scheduled: int, **kwargs: object) -> BoardEntry:
    fields: dict[str, object] = {
        "tripId": trip_id,
        "tripShortName": name,
        "routeShortName": "",
        "routeTextColor": None,
        "headsign": "Budapest-Déli",
        "serviceDate": "2026-10-28",
        "scheduledTime": scheduled,
        "expectedTime": scheduled,
        "delayMinutes": 0,
        "delaySource": "otp",
        "platform": "4",
        "realtime": True,
        "canceled": False,
        "vehicleId": None,
    }
    fields.update(kwargs)
    return BoardEntry.model_validate(fields)


def test_duplicate_trips_of_one_train_are_merged() -> None:
    intercity = _entry("1:a", "201 AGRAM - TÓPART InterCity", 1000)
    fast = _entry(
        "1:b", "201 AGRAM - TÓPART gyorsvonat", 1000, delaySource="gps", delayMinutes=7
    )
    other = _entry("1:c", "201 AGRAM - TÓPART InterCity", 5000)
    different = _entry("1:d", "2010 személyvonat", 1000)

    merged = merge_duplicate_trips([intercity, fast, other, different])

    assert sorted(e.tripId for e in merged) == ["1:b", "1:c", "1:d"]


def test_duplicate_merge_prefers_running_over_canceled() -> None:
    canceled = _entry("1:a", "201 InterCity", 1000, canceled=True)
    running = _entry("1:b", "201 gyorsvonat", 1000, realtime=False)

    assert [e.tripId for e in merge_duplicate_trips([canceled, running])] == ["1:b"]


def _stoptime(alerts: list[dict[str, Any]]) -> dict[str, Any]:
    board = load_fixture("otp-board-kelenfold-departures.json")
    stoptime: dict[str, Any] = board["data"]["station"]["stoptimesWithoutPatterns"][0]
    stoptime["trip"]["alerts"] = alerts
    return stoptime


def test_board_entry_marks_a_train_its_own_notice_replaces() -> None:
    # 4770 leaves Kelenföld at serviceDay + 1620
    at = 1793228400 + 1620
    bus = {
        "alertDescriptionText": "Pótlóbusz közlekedik, megállói: Kelenföld.",
        "effectiveStartDate": at - 3600,
        "effectiveEndDate": at + 3600,
    }
    over = {**bus, "effectiveEndDate": at - 60}
    coaches = {"alertDescriptionText": "Utolsó kettő kocsija lezárva közlekedik."}

    replaced = _board_entry(_stoptime([coaches, bus]), "departures", {})
    expired = _board_entry(_stoptime([over]), "departures", {})
    normal = _board_entry(_stoptime([coaches]), "departures", {})

    assert replaced.disruption == "replacement_bus"
    assert expired.disruption is None
    assert normal.disruption is None


# HÉV boards of 2026-10-29: H8/H9 trains turn back at Cinkota, and each
# carries "... az Örs vezér tere és Cinkota között pótlóbuszok közlekednek."
KEREPES_HEV = "003619848"
CINKOTA_HEV = "003619828"


def _hev_board(name: str) -> list[dict[str, Any]]:
    board = load_fixture("otp-board-hev-cinkota.json")[name]
    stoptimes: list[dict[str, Any]] = board["data"]["station"][
        "stoptimesWithoutPatterns"
    ]
    return stoptimes


def test_board_does_not_mark_trains_running_beyond_the_replaced_stretch() -> None:
    departures = [
        _board_entry(st, "departures", {}, None, KEREPES_HEV)
        for st in _hev_board("kerepes")
    ]
    arrivals = [
        _board_entry(st, "arrivals", {}, None, CINKOTA_HEV)
        for st in _hev_board("cinkota")
    ]

    # Cinkota - Gödöllő and Kerepes - Cinkota run as shown
    assert [e.disruption for e in departures] == [None, None]
    assert [e.disruption for e in arrivals] == [None, None]


def test_board_marks_trains_on_the_replaced_stretch() -> None:
    # The same notice on a train still running from Örs vezér tere
    [stoptime, _] = _hev_board("kerepes")
    trip = stoptime["trip"]
    trip["stops"] = [
        {"gtfsId": "1:003619801_0", "name": "Örs vezér tere H"},
        {"gtfsId": "1:003619802_0", "name": "Rákosfalva H"},
        *trip["stops"],
    ]

    def entry(station: str, kind: BoardKind) -> BoardEntry:
        return _board_entry(stoptime, kind, {}, None, station)

    assert entry("003619802", "departures").disruption == "replacement_bus"
    assert entry(CINKOTA_HEV, "arrivals").disruption == "replacement_bus"
    assert entry(CINKOTA_HEV, "departures").disruption is None
    assert entry(KEREPES_HEV, "departures").disruption is None


def test_board_marks_a_skipped_stop_only_there() -> None:
    # 4770 Budapest-Déli - Székesfehérvár via Kelenföld
    at = 1793228400 + 1620
    stoptime = _stoptime(
        [{"alertDescriptionText": "A vonat Budafok megállóhelyen nem áll meg."}]
    )
    stoptime["trip"]["stops"] = [
        {"gtfsId": "1:005501016_0", "name": "Budapest-Déli"},
        {"gtfsId": f"1:{KELENFOLD}_0", "name": "Budapest-Kelenföld"},
        {"gtfsId": "1:005503129_0", "name": "Budafok"},
        {"gtfsId": "1:005503269_0", "name": "Székesfehérvár"},
    ]

    here = _board_entry(stoptime, "departures", {}, None, KELENFOLD)
    there = _board_entry(stoptime, "departures", {}, None, "005503129")

    assert at == here.scheduledTime
    assert here.disruption is None
    assert there.disruption == "no_service"
