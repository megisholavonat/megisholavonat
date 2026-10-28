from datetime import date, datetime
from typing import Any

import fakeredis
import polyline  # type: ignore[import-untyped]
import pytest
import pytz
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services import history
from api.services.history import (
    MemoryWatermarks,
    detect_passages,
    drop_old_partitions,
    ensure_partition,
    list_partitions,
    record_from_cache,
    record_locations,
    rollup_day,
)
from api.services.train_service import TrainService
from api.util.stop import station_id, station_id_from_gtfs_id

BUDAPEST = pytz.timezone("Europe/Budapest")
SERVICE_DATE = "2026-08-14"
LAT = 47.0
# Four stops along a straight east-west line, 0.1 degrees (~7.6 km) apart,
# scheduled 10:00, 10:05, 10:10, 10:15 local time
STOP_LONS = [19.0, 19.1, 19.2, 19.3]
STOP_TIMES = [10 * 3600 + i * 300 for i in range(4)]


def _unix(hh: int, mm: int, ss: int = 0) -> int:
    local = BUDAPEST.localize(datetime(2026, 8, 14, hh, mm, ss))
    return int(local.timestamp())


def _vehicle(lon: float, at: int, lat: float = LAT) -> dict[str, Any]:
    stoptimes = [
        {
            "stopPosition": 10 * (i + 1),
            "scheduledArrival": t,
            "realtimeArrival": t + 60,
            "scheduledDeparture": t,
            "realtimeDeparture": t + 120,
            "stop": {
                "gtfsId": f"1:stop{i}",
                "stationUicPricingCode": "005500000" if i == 0 else None,
                "name": f"Stop {i}",
                "lat": LAT,
                "lon": stop_lon,
                "platformCode": str(i + 1),
            },
        }
        for i, (stop_lon, t) in enumerate(zip(STOP_LONS, STOP_TIMES, strict=True))
    ]
    return {
        "vehicleId": "1:veh",
        "lat": lat,
        "lon": lon,
        "heading": 90.0,
        "speed": 80.0,
        "lastUpdated": at,
        "trip": {
            "gtfsId": "1:trip",
            "serviceDate": SERVICE_DATE,
            "tripShortName": "1234 Test",
            "route": {"shortName": "S1", "mode": "RAIL"},
            "tripGeometry": {
                "points": polyline.encode([(LAT, lon) for lon in STOP_LONS])
            },
            "stoptimes": stoptimes,
        },
    }


def _process(lon: float, at: int, lat: float = LAT) -> dict[str, Any]:
    service = TrainService(None)  # type: ignore[arg-type]
    service.reference_time = at
    located = service.add_counties_to_locations([_vehicle(lon, at, lat)])
    [processed] = service.process_locations(located)
    return processed


def _seqs(passages: list[history.Passage]) -> list[int]:
    return [p.row["stop_sequence"] for p in passages]


# --- Passing-stop detection ---


def test_origin_not_passed_while_standing_at_platform() -> None:
    # 100 m past the stop point, before departure time
    loc = _process(19.0013, _unix(9, 58))

    passages, wm = detect_passages(loc, None)

    assert passages == []
    assert wm == -1


def test_origin_passed_after_departure_with_our_delay() -> None:
    # Two minutes late, ~1.5 km out of the origin
    loc = _process(19.02, _unix(10, 3))

    passages, wm = detect_passages(loc, -1)

    assert _seqs(passages) == [0]
    assert wm == 0
    row = passages[0].row
    assert row["trip_gtfs_id"] == "1:trip"
    assert row["service_date"] == date(2026, 8, 14)
    assert row["stop_id"] == "1:stop0"
    assert row["station_id"] == "005500000"  # stationUicPricingCode
    assert passages[0].stop["station_id"] == "005500000"
    assert row["gtfs_stop_sequence"] == 10
    # Our GPS estimate: 10:03 at 20% of a 5-minute leg -> 2 minutes late
    assert row["delay_s"] == pytest.approx(120, abs=5)
    assert row["otp_arrival_delay_s"] == 60
    assert row["otp_departure_delay_s"] == 120
    assert row["platform"] == "1"


def test_watermark_prevents_recording_twice() -> None:
    loc = _process(19.05, _unix(10, 3))
    _, wm = detect_passages(loc, None)

    again, wm2 = detect_passages(_process(19.06, _unix(10, 4)), wm)

    assert again == []
    assert wm2 == wm == 0


def test_several_stops_passed_between_observations() -> None:
    # Previously seen before stop 1; now just past stop 2
    loc = _process(19.21, _unix(10, 11))

    passages, wm = detect_passages(loc, 0)

    assert _seqs(passages) == [1, 2]
    assert wm == 2


def test_first_sighting_mid_route_skips_stops_passed_long_ago() -> None:
    # First seen just after stop 2: stop 0 was over 10 schedule-minutes ago
    loc = _process(19.21, _unix(10, 11))

    passages, _ = detect_passages(loc, None)

    assert _seqs(passages) == [1, 2]


def test_terminus_recorded_on_arrival() -> None:
    loc = _process(19.3, _unix(10, 18))

    passages, wm = detect_passages(loc, 2)

    assert _seqs(passages) == [3]
    assert wm == 3
    assert passages[0].row["delay_s"] == pytest.approx(180, abs=5)


def test_vehicle_preassigned_to_next_trip_is_ignored() -> None:
    # Vehicle is already listed on this trip at 09:30, half an hour early
    loc = _process(19.05, _unix(9, 30))

    assert detect_passages(loc, None) == ([], None)


def test_off_route_position_is_ignored() -> None:
    # ~1.1 km north of the line
    loc = _process(19.05, _unix(10, 3), lat=LAT + 0.01)

    assert detect_passages(loc, None) == ([], None)


def test_impossible_delay_is_ignored() -> None:
    loc = _process(19.05, _unix(17, 6))

    assert detect_passages(loc, None) == ([], None)


# --- Storage ---


async def test_record_locations_inserts_once(db_session: AsyncSession) -> None:
    watermarks = MemoryWatermarks()
    loc = _process(19.21, _unix(10, 11))

    first = await record_locations(db_session, watermarks, [loc])
    # A fresh watermark store would try again; ON CONFLICT keeps one row each
    second = await record_locations(db_session, MemoryWatermarks(), [loc])

    assert first == 2
    assert second == 0
    assert watermarks.values == {(SERVICE_DATE, "1:trip"): 2}
    count = await db_session.scalar(
        text("SELECT count(*) FROM stop_delay_observations")
    )
    assert count == 2
    stop: str = (
        await db_session.execute(
            text("SELECT name FROM stops WHERE gtfs_id = '1:stop1'")
        )
    ).scalar_one()
    assert stop == "Stop 1"
    assert "stop_delay_observations_y2026m08" in await list_partitions(db_session)


async def test_record_from_replayed_cache(
    db_session: AsyncSession, redis: fakeredis.FakeAsyncRedis
) -> None:
    service = TrainService(redis)
    total = 0
    for _ in range(10):
        await service.refresh_data()
        total += await record_from_cache(redis, db_session)

    count = await db_session.scalar(
        text("SELECT count(*) FROM stop_delay_observations")
    )
    assert count == total
    assert total > 0
    watermarks = await redis.keys("mhav-test:history-watermarks:*")
    assert watermarks


# --- Maintenance ---


async def _insert_observation(
    session: AsyncSession, day: date, trip: str, stop: str, route: str, delay: int
) -> None:
    await session.execute(
        text(
            "INSERT INTO stops (gtfs_id, station_id, name, lat, lon) "
            "VALUES (:s, :station, :s, 0, 0) ON CONFLICT DO NOTHING"
        ),
        {"s": stop, "station": station_id_from_gtfs_id(stop)},
    )
    await session.execute(
        text(
            "INSERT INTO stop_delay_observations (service_date, trip_gtfs_id, "
            "stop_sequence, trip_short_name, route_short_name, stop_id, station_id, "
            "delay_s, observed_at) "
            "VALUES (:d, :t, 0, :t, :r, :s, :station, :delay, now())"
        ),
        {
            "d": day,
            "t": trip,
            "r": route,
            "s": stop,
            "station": station_id_from_gtfs_id(stop),
            "delay": delay,
        },
    )


async def test_rollup_day(db_session: AsyncSession) -> None:
    day = date(2026, 8, 14)
    await ensure_partition(db_session, day)
    delays = [-60, 0, 120, 300, 301, 600, 900, 1200, 1800, 3600]
    # One station, trains spread over two of its platforms
    for i, delay in enumerate(delays):
        platform = "1:005501024_1" if i % 2 else "1:005501024_14"
        await _insert_observation(db_session, day, f"t{i}", platform, "S1", delay)
    await _insert_observation(db_session, day, "other", "1:005501164_5b", "S1", 30)
    await _insert_observation(
        db_session, date(2026, 8, 15), "next", "1:005501024_1", "S1", 0
    )

    assert await rollup_day(db_session, day) == 2
    # Idempotent
    assert await rollup_day(db_session, day) == 2

    row = (
        await db_session.execute(
            text(
                "SELECT n, n_on_time, sum_delay_s, p90_delay_s, max_delay_s "
                "FROM delay_daily_agg WHERE station_id = '005501024'"
            )
        )
    ).one()
    assert row.n == 10
    assert row.n_on_time == 4  # <= 5 minutes late, early counts as on time
    assert row.sum_delay_s == sum(delays)
    assert row.p90_delay_s == 1980  # percentile_cont(0.9) of the ten delays
    assert row.max_delay_s == 3600


async def test_drop_old_partitions(db_session: AsyncSession) -> None:
    for d in (date(2025, 8, 3), date(2025, 9, 3), date(2026, 10, 3)):
        await ensure_partition(db_session, d)

    dropped = await drop_old_partitions(db_session, date(2026, 10, 28), 13)

    assert dropped == ["stop_delay_observations_y2025m08"]
    remaining = await list_partitions(db_session)
    assert "stop_delay_observations_y2025m09" in remaining
    assert "stop_delay_observations_y2026m10" in remaining


# --- Station ids ---


@pytest.mark.parametrize(
    ("gtfs_id", "expected"),
    [
        ("1:005501024_14", "005501024"),
        ("1:005505876_5b", "005505876"),
        ("1:005546409_mh", "005546409"),
        ("1:005515362_", "005515362"),
        ("1:005517665_mh.", "005517665"),
        ("1:005510017", "005510017"),
    ],
)
def test_station_id_from_gtfs_id(gtfs_id: str, expected: str) -> None:
    assert station_id_from_gtfs_id(gtfs_id) == expected


def test_station_id_prefers_uic_code() -> None:
    assert station_id({"gtfsId": "1:x_1", "stationUicPricingCode": "005510017"}) == (
        "005510017"
    )
    assert station_id({"gtfsId": "1:005510017_3"}) == "005510017"
    assert station_id({}) is None
