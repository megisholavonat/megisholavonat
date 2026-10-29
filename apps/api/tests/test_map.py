import json
from datetime import date, timedelta
from typing import Any

import fakeredis
import httpx
import polyline  # type: ignore[import-untyped]
import respx
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.history import DelayDailyAgg
from api.services import map_layers
from api.services.map_layers import (
    PatternTrips,
    build_network,
    full_days,
    layer_key,
    patterns_from_otp,
    station_features,
    store_layer,
    trains_per_day,
)
from api.services.station_index import _indexed
from tests.upstream import graphql_route, load_fixture

LAT = 47.503
RAIL = {"mode": "RAIL", "agency": {"name": "MÁV-START"}}
HEV = {"mode": "SUBURBAN_RAILWAY", "agency": {"name": "MÁV Személyszállítási (HÉV)"}}


def _line(lon0: float, lon1: float, lat: float = LAT, step: float = 0.001) -> str:
    """An east-west line along `lat`, a point every `step` degrees."""
    count = round((lon1 - lon0) / step)
    return polyline.encode([(lat, lon0 + i * step) for i in range(count + 1)])


def _pattern(
    route: dict[str, Any] | None, points: str | None, trips: int
) -> dict[str, Any]:
    return {
        "route": route,
        "patternGeometry": {"points": points} if points is not None else None,
        "tripsForDate": [{"id": f"t{i}"} for i in range(trips)],
    }


def _features(collection: dict[str, Any]) -> list[tuple[int, int, list[Any]]]:
    return [
        (
            f["properties"]["n"],
            f["properties"]["hev"],
            f["geometry"]["coordinates"],
        )
        for f in collection["features"]
    ]


# Network


def test_patterns_keep_passenger_rail_running_that_day() -> None:
    line = _line(19.0, 19.1)
    patterns = patterns_from_otp(
        [
            _pattern(RAIL, line, 3),
            _pattern(HEV, line, 2),
            # An Austrian S-Bahn shares the HÉV's mode but is a railway
            _pattern({"mode": "SUBURBAN_RAILWAY", "agency": {"name": "ÖBB"}}, line, 1),
            _pattern({"mode": "RAIL_REPLACEMENT_BUS"}, line, 5),
            _pattern({"mode": "COACH"}, line, 5),
            _pattern(RAIL, line, 0),
            _pattern(RAIL, None, 4),
            _pattern(RAIL, "", 4),
            None,
        ]
    )

    assert [(p.trips, p.hev) for p in patterns] == [(3, False), (2, True), (1, False)]


def test_overlapping_patterns_add_up_on_the_grid() -> None:
    patterns = patterns_from_otp(
        [
            _pattern(RAIL, _line(19.0, 19.1), 3),
            # Same track a few metres off, continuing further east
            _pattern(RAIL, _line(19.05, 19.2, lat=LAT + 0.0003), 2),
        ]
    )

    features = _features(build_network(patterns))

    # Each stretch is drawn once with the trains of every pattern on it,
    # quietest first; straight runs simplify to their ends
    assert [(n, hev) for n, hev, _ in features] == [(2, 0), (3, 0), (5, 0)]
    (_, _, east), (_, _, west), (_, _, shared) = features
    assert west[0] == [19.0, LAT]
    assert west[-1] == shared[0]
    assert shared[-1] == [19.1, LAT]
    assert east[-1] == [19.2, LAT + 0.0003]
    assert all(len(coords) == 2 for _, _, coords in features)


def test_stop_to_stop_geometry_counts_on_the_same_track() -> None:
    patterns = patterns_from_otp(
        [
            _pattern(RAIL, _line(19.0, 19.1), 3),
            # Only the two end points: a straight line drawn stop to stop
            _pattern(RAIL, polyline.encode([(LAT, 19.0), (LAT, 19.1)]), 4),
        ]
    )

    assert [n for n, _, _ in _features(build_network(patterns))] == [7]


def test_hev_is_counted_and_drawn_apart_from_the_railway() -> None:
    patterns = patterns_from_otp(
        [_pattern(RAIL, _line(19.0, 19.1), 3), _pattern(HEV, _line(19.0, 19.1), 10)]
    )

    features = _features(build_network(patterns))

    assert [(n, hev) for n, hev, _ in features] == [(3, 0), (10, 1)]


def test_network_keeps_curves_and_rounds_coordinates() -> None:
    # A right angle, sampled densely, with noise far below the tolerance
    points = [(LAT, 19.0 + i * 0.001 + 0.0000012) for i in range(50)]
    points += [(LAT + i * 0.001, 19.049) for i in range(1, 50)]
    patterns = [PatternTrips(points=points, trips=1, hev=False)]

    ((_, _, coords),) = _features(build_network(patterns))

    assert coords == [[19.0, LAT], [19.049, LAT], [19.049, 47.552]]


def test_network_is_clipped_to_the_map_area() -> None:
    patterns = patterns_from_otp([_pattern(RAIL, _line(16.0, 16.2, lat=48.0), 1)])

    ((_, _, coords),) = _features(build_network(patterns, bbox=(45, 16.1, 49, 23)))

    assert coords[0][0] >= 16.1
    assert coords[-1] == [16.2, 48.0]


# Stations


def test_station_features_rank_and_name_stations() -> None:
    stations = [
        _indexed("005510017", "Budapest-Keleti", 47.500, 19.083),
        _indexed("005501289", "Győr", 47.682, 17.635),
        _indexed("003609142", "Szentendre H", 47.667, 19.076, "hev"),
        # The tram-train is no HÉV
        _indexed("005500700", "Szeged vasútállomás", 46.2416, 20.1415, "tramtrain"),
        _indexed("002200001", "Kyiv-Pas.", 50.44, 30.49),
        _indexed("005501024", "Budapest-Kelenföld", 47.464, 19.019),
    ]
    per_day = {"005510017": 180.5, "005501024": 250.0, "003609142": 60.0}

    features = station_features(stations, per_day)["features"]

    assert [f["properties"] for f in features] == [
        {
            "id": "005501024",
            "name": "Budapest-Kelenföld",
            "short": "Kelenföld",
            "perDay": 250.0,
            "hev": 0,
        },
        {
            "id": "005510017",
            "name": "Budapest-Keleti",
            "short": "Keleti",
            "perDay": 180.5,
            "hev": 0,
        },
        {
            "id": "003609142",
            "name": "Szentendre H",
            "short": "Szentendre H",
            "perDay": 60.0,
            "hev": 1,
        },
        {"id": "005501289", "name": "Győr", "short": "Győr", "perDay": 0.0, "hev": 0},
        {
            "id": "005500700",
            "name": "Szeged vasútállomás",
            "short": "Szeged vasútállomás",
            "perDay": 0.0,
            "hev": 0,
        },
    ]
    assert features[0]["geometry"] == {"type": "Point", "coordinates": [19.019, 47.464]}


def test_full_days_skip_partly_recorded_days() -> None:
    start = date(2026, 10, 1)
    totals = [(start + timedelta(days=i), 1000 + i) for i in range(20)]
    totals[-1] = (totals[-1][0], 100)  # recording was down most of the day

    days = full_days(totals)

    assert len(days) == 14
    assert days[-1] == start + timedelta(days=18)
    assert days[0] == start + timedelta(days=5)
    assert full_days([]) == []


def _agg(day: date, station: str, route: str, n: int) -> DelayDailyAgg:
    return DelayDailyAgg(
        service_date=day,
        station_id=station,
        route_short_name=route,
        n=n,
        n_on_time=n,
        sum_delay_s=0,
        p90_delay_s=0,
        max_delay_s=0,
    )


async def test_trains_per_day_averages_full_days(db_session: AsyncSession) -> None:
    today = date(2026, 10, 29)
    d1, d2, partial = (today - timedelta(days=i) for i in (3, 2, 1))
    db_session.add_all(
        [
            # Routes of a day add up
            _agg(d1, "005510017", "IC", 100),
            _agg(d1, "005510017", "S70", 51),
            _agg(d2, "005510017", "IC", 150),
            _agg(d1, "005501289", "IC", 40),
            # Partly recorded; left out
            _agg(partial, "005510017", "IC", 10),
            # Older than the history looked at
            _agg(today - timedelta(days=200), "005501024", "IC", 999),
        ]
    )
    await db_session.flush()

    per_day = await trains_per_day(db_session, today)

    # Győr has no trains on the second day: it averages over both
    assert per_day == {"005510017": 150.5, "005501289": 20.0}


# Endpoints


async def test_network_serves_stored_body_with_etag(
    client: httpx.AsyncClient, redis: fakeredis.FakeAsyncRedis
) -> None:
    body = '{"type":"FeatureCollection","features":[]}'
    stored = await store_layer(redis, "network", body)

    response = await client.get("/v1/map/network")

    assert response.status_code == 200
    assert response.text == body
    assert response.headers["content-type"] == "application/json"
    assert response.headers["etag"] == stored.etag
    assert response.headers["cache-control"] == (
        "public, max-age=3600, stale-while-revalidate=86400"
    )

    for if_none_match in (stored.etag, f'"other", W/{stored.etag}', "*"):
        cached = await client.get(
            "/v1/map/network", headers={"If-None-Match": if_none_match}
        )
        assert cached.status_code == 304
        assert cached.content == b""
        assert cached.headers["etag"] == stored.etag

    stale = await client.get("/v1/map/network", headers={"If-None-Match": '"old"'})
    assert stale.status_code == 200
    assert stale.text == body


def _network_responder(request: httpx.Request) -> httpx.Response:
    body = json.loads(request.content)
    query: str = body["query"]
    if "query MapPatternCodes" in query:
        stops = [
            {"vehicleMode": "RAIL", "patterns": [{"code": "1:A::01"}]},
            {
                "vehicleMode": None,
                "patterns": [{"code": "1:A::01"}, {"code": "1:A::rt#1"}],
            },
            {"vehicleMode": "RAIL_REPLACEMENT_BUS", "patterns": [{"code": "1:B::01"}]},
        ]
        return httpx.Response(200, json={"data": {"stopsByBbox": stops}})
    if "query MapPatterns" in query:
        assert body["variables"]["date"].isdigit()
        assert '"1:A::01"' in query
        assert "rt#" not in query
        assert "1:B::01" not in query
        pattern = _pattern(RAIL, _line(19.0, 19.1), 6)
        return httpx.Response(200, json={"data": {"p0": pattern}})
    return httpx.Response(400, json={"errors": [{"message": "unexpected"}]})


async def test_network_is_built_once_on_a_miss(
    client: httpx.AsyncClient,
    otp: respx.MockRouter,
    redis: fakeredis.FakeAsyncRedis,
) -> None:
    route = graphql_route(otp).mock(side_effect=_network_responder)

    first = await client.get("/v1/map/network")
    second = await client.get("/v1/map/network")

    assert first.status_code == 200
    network = first.json()
    assert network["type"] == "FeatureCollection"
    assert [f["properties"] for f in network["features"]] == [{"n": 6, "hev": 0}]
    assert second.text == first.text
    assert second.headers["etag"] == first.headers["etag"]
    assert route.call_count == 2  # pattern codes, then one batch of patterns
    assert await redis.ttl(layer_key("network")) > 3 * 24 * 60 * 60
    assert await redis.get(map_layers.add_key("map-network-build-lock")) is None


async def test_stations_are_built_from_index_and_history(
    client: httpx.AsyncClient,
    otp: respx.MockRouter,
    db_session: AsyncSession,
) -> None:
    graphql_route(otp).mock(
        return_value=httpx.Response(200, json=load_fixture("otp-stations.json"))
    )
    yesterday = map_layers.today() - timedelta(days=1)
    db_session.add(_agg(yesterday, "005501289", "IC", 42))
    await db_session.flush()

    response = await client.get("/v1/map/stations")

    assert response.status_code == 200
    features = response.json()["features"]
    assert features[0]["properties"] == {
        "id": "005501289",
        "name": "Győr",
        "short": "Győr",
        "perDay": 42.0,
        "hev": 0,
    }
    assert all(f["properties"]["perDay"] == 0 for f in features[1:])
    by_name = {f["properties"]["name"]: f["properties"] for f in features}
    assert by_name["Szentendre H"]["hev"] == 1
    assert by_name["Budapest-Kelenföld"]["short"] == "Kelenföld"
