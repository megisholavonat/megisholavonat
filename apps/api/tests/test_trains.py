import fakeredis
import httpx
import polyline  # type: ignore[import-untyped]
from shapely.geometry import LineString, Point
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services.train_service import TrainService
from api.util.route import LIST_POLYLINE_TOLERANCE

SNAPSHOTS_IN_FIXTURE = 10


async def test_database_session_works(db_session: AsyncSession) -> None:
    assert (await db_session.execute(text("SELECT 1"))).scalar_one() == 1


async def test_trains_empty_cache(client: httpx.AsyncClient) -> None:
    response = await client.get("/v1/trains")

    assert response.status_code == 200
    body = response.json()
    assert body["noDataReceived"] is True
    assert body["features"] == []


async def test_trains_after_replayed_refresh(
    client: httpx.AsyncClient, redis: fakeredis.FakeAsyncRedis
) -> None:
    await TrainService(redis).refresh_data()

    response = await client.get("/v1/trains")

    assert response.status_code == 200
    body = response.json()
    assert body["noDataReceived"] is False
    # Snapshots are from August; with wall-clock staleness every train would be
    # dropped. All 12 fixture vehicles must survive.
    assert len(body["features"]) == 12
    props = body["features"][0]["properties"]
    assert props["vehicleId"]
    assert props["tripShortName"]
    assert isinstance(props["delay"], int)
    assert "reason" in props
    # The final stop, as in the trip's stoptimes
    assert all(f["properties"]["headsign"] for f in body["features"])


async def test_train_details(
    client: httpx.AsyncClient, redis: fakeredis.FakeAsyncRedis
) -> None:
    await TrainService(redis).refresh_data()
    trains = (await client.get("/v1/trains")).json()["features"]
    vehicle_id = trains[0]["properties"]["vehicleId"]

    response = await client.get(f"/v1/trains/{vehicle_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["vehicleId"] == vehicle_id
    assert body["trip"]["stoptimes"]
    assert body["processedStops"]
    assert body["vehicleProgress"]["lastStop"]


async def test_train_details_not_found(client: httpx.AsyncClient) -> None:
    response = await client.get("/v1/trains/does-not-exist")

    assert response.status_code == 404


async def test_replay_advances_and_loops(redis: fakeredis.FakeAsyncRedis) -> None:
    service = TrainService(redis)
    times = []
    for _ in range(SNAPSHOTS_IN_FIXTURE + 1):
        await service.fetch_graphql_data()
        assert service.reference_time is not None
        times.append(service.reference_time)

    assert times[:SNAPSHOTS_IN_FIXTURE] == sorted(set(times[:SNAPSHOTS_IN_FIXTURE]))
    assert times[SNAPSHOTS_IN_FIXTURE] == times[0]


async def test_trains_are_compressed(
    client: httpx.AsyncClient, redis: fakeredis.FakeAsyncRedis
) -> None:
    await TrainService(redis).refresh_data()

    response = await client.get("/v1/trains", headers={"Accept-Encoding": "gzip"})

    assert response.headers["content-encoding"] == "gzip"
    assert int(response.headers["content-length"]) < len(response.content)


async def test_list_polylines_are_thinned(
    client: httpx.AsyncClient, redis: fakeredis.FakeAsyncRedis
) -> None:
    await TrainService(redis).refresh_data()
    feature = (await client.get("/v1/trains")).json()["features"][0]
    vehicle_id = feature["properties"]["vehicleId"]
    details = (await client.get(f"/v1/trains/{vehicle_id}")).json()

    listed = polyline.decode(feature["properties"]["routePolyline"])
    full = polyline.decode(details["trip"]["tripGeometry"]["points"])

    assert 2 <= len(listed) < len(full)
    # Same ends, and every point of the full line within the tolerance
    assert listed[0] == full[0]
    assert listed[-1] == full[-1]
    line = LineString(listed)
    tolerance = LIST_POLYLINE_TOLERANCE + 1e-5  # polyline rounding
    assert max(line.distance(Point(p)) for p in full) <= tolerance
