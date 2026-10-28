from datetime import UTC, date, datetime, timedelta
from typing import Any

import fakeredis
import httpx
import pytest
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.history import Stop, StopDelayObservation
from api.services.history import ensure_partition

MONDAY = date(2026, 9, 7)
KELETI = "005510017"
SZOLNOK = "005510009"
DEBRECEN = "005510710"
NAMES = {KELETI: "Budapest-Keleti", SZOLNOK: "Szolnok", DEBRECEN: "Debrecen"}


def _obs(
    delay_s: int,
    *,
    day: date = MONDAY,
    trip: str | None = None,
    train: str = "10 TRANSCARPATHIA",
    route: str = "IC",
    station: str = KELETI,
    seq: int = 0,
    platform: str | None = "1",
    scheduled_s: int = 8 * 3600,
    observed_at: datetime | None = None,
) -> dict[str, Any]:
    return {
        "service_date": day,
        "trip_gtfs_id": trip or f"1:{train.split()[0]}-{station}-{delay_s}-{seq}",
        "stop_sequence": seq,
        "trip_short_name": train,
        "route_short_name": route,
        "stop_id": f"1:{station}_{platform or 0}",
        "station_id": station,
        "scheduled_arrival_s": scheduled_s,
        "scheduled_departure_s": scheduled_s,
        "delay_s": delay_s,
        "platform": platform,
        "observed_at": observed_at
        or datetime.combine(day, datetime.min.time(), tzinfo=UTC)
        + timedelta(seconds=scheduled_s),
    }


async def _seed(session: AsyncSession, rows: list[dict[str, Any]]) -> None:
    stops = {
        r["stop_id"]: {
            "gtfs_id": r["stop_id"],
            "station_id": r["station_id"],
            "name": NAMES.get(r["station_id"], r["station_id"]),
            "lat": 47.0,
            "lon": 19.0,
        }
        for r in rows
    }
    await session.execute(
        insert(Stop).values(list(stops.values())).on_conflict_do_nothing()
    )
    for d in {r["service_date"] for r in rows}:
        await ensure_partition(session, d)
    await session.execute(insert(StopDelayObservation).values(rows))
    await session.flush()


def _runs(delays: list[int], **kwargs: Any) -> list[dict[str, Any]]:
    """One observation per day, going back from MONDAY."""
    return [
        _obs(d, day=MONDAY - timedelta(days=i), trip=f"1:run{i}", **kwargs)
        for i, d in enumerate(delays)
    ]


# --- Train at station ---


async def test_train_station_median_and_percentile(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    await _seed(db_session, _runs([0, 60, 120, 180, 600, 1200]))

    r = await client.get(f"/v1/history/trains/10/stations/{KELETI}")

    assert r.status_code == 200
    body = r.json()
    assert body["n"] == 6
    assert body["stationName"] == "Budapest-Keleti"
    # percentile_cont: halfway between 120 s and 180 s
    assert body["medianDelayMin"] == 2.5
    # 0.8 * 5 = position 4 -> 600 s
    assert body["p80DelayMin"] == 10.0
    assert body["onTimeShare"] == pytest.approx(4 / 6, abs=1e-3)
    assert body["insufficientData"] is False
    assert body["window"] == {"start": "2026-08-11", "end": "2026-09-07", "days": 28}


async def test_on_time_threshold_is_inclusive_at_five_minutes(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    await _seed(db_session, _runs([299, 300, 301, 360, -60]))

    body = (await client.get(f"/v1/history/trains/10/stations/{KELETI}")).json()

    # -60, 299 and 300 are on time; 301 and 360 are not
    assert body["onTimeShare"] == 0.6


async def test_insufficient_data_below_five_samples(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    await _seed(db_session, _runs([60, 60, 60, 60]))
    body = (await client.get(f"/v1/history/trains/10/stations/{KELETI}")).json()
    assert body["n"] == 4
    assert body["insufficientData"] is True
    assert body["medianDelayMin"] == 1.0


async def test_five_samples_are_sufficient(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    await _seed(db_session, _runs([60, 60, 60, 60, 60]))
    body = (await client.get(f"/v1/history/trains/10/stations/{KELETI}")).json()
    assert body["insufficientData"] is False


async def test_no_data_is_insufficient(client: httpx.AsyncClient) -> None:
    body = (await client.get(f"/v1/history/trains/10/stations/{KELETI}")).json()
    assert body["n"] == 0
    assert body["insufficientData"] is True
    assert body["medianDelayMin"] is None
    assert body["typicalPlatform"] is None


async def test_weekday_weekend_split(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    # MONDAY - 2 is a Saturday and MONDAY - 1 a Sunday
    await _seed(db_session, _runs([0, 600, 900, 0, 0, 0, 0, 0]))

    body = (await client.get(f"/v1/history/trains/10/stations/{KELETI}")).json()

    assert body["n"] == 8
    assert body["weekend"]["n"] == 2
    assert body["weekend"]["medianDelayMin"] == 12.5
    assert body["weekend"]["insufficientData"] is True
    assert body["weekday"]["n"] == 6
    assert body["weekday"]["onTimeShare"] == 1.0


async def test_train_number_is_the_first_token_only(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    await _seed(
        db_session,
        _runs([60] * 5) + _runs([900] * 5, train="100 Other", seq=1),
    )
    body = (await client.get(f"/v1/history/trains/10/stations/{KELETI}")).json()
    assert body["n"] == 5
    assert body["medianDelayMin"] == 1.0


async def test_window_counts_back_from_latest_recorded_day(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    # Ten runs, one per day; a 3-day window keeps the last three
    await _seed(db_session, _runs([0, 0, 0, 600, 600, 600, 600, 600, 600, 600]))

    body = (await client.get(f"/v1/history/trains/10/stations/{KELETI}?days=3")).json()

    assert body["n"] == 3
    assert body["medianDelayMin"] == 0.0
    assert body["window"]["start"] == "2026-09-05"


# --- Train route ---


async def test_train_route_in_schedule_order_without_rare_stations(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    rows = []
    for i in range(4):
        day, trip = MONDAY - timedelta(days=i), f"1:run{i}"
        rows += [
            _obs(0, day=day, trip=trip, station=KELETI, seq=0, scheduled_s=8 * 3600),
            _obs(
                120 * i,
                day=day,
                trip=trip,
                station=SZOLNOK,
                seq=5,
                scheduled_s=9 * 3600,
            ),
            _obs(
                600, day=day, trip=trip, station=DEBRECEN, seq=9, scheduled_s=11 * 3600
            ),
        ]
    # Diverted once via an unusual station
    rows.append(_obs(0, trip="1:run0", station="005599999", seq=7, scheduled_s=36000))
    await _seed(db_session, rows)

    body = (await client.get("/v1/history/trains/10")).json()

    assert body["runs"] == 4
    assert body["tripShortName"] == "10 TRANSCARPATHIA"
    assert body["routeShortName"] == "IC"
    assert [s["stationId"] for s in body["stations"]] == [KELETI, SZOLNOK, DEBRECEN]
    szolnok = body["stations"][1]
    assert szolnok["stationName"] == "Szolnok"
    assert szolnok["scheduledTimeS"] == 9 * 3600
    assert szolnok["n"] == 4
    assert szolnok["medianDelayMin"] == 3.0  # 0, 120, 240, 360 s
    assert szolnok["insufficientData"] is True


async def test_responses_are_cached(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    redis: fakeredis.FakeAsyncRedis,
) -> None:
    await _seed(db_session, _runs([60] * 5))
    first = (await client.get(f"/v1/history/trains/10/stations/{KELETI}")).json()

    keys = await redis.keys("*")
    assert keys == [f"mhav-test:history:train-station:10:{KELETI}:28"]
    assert 0 < await redis.ttl(keys[0]) <= 600

    await _seed(db_session, _runs([900] * 5, seq=1))
    second = (await client.get(f"/v1/history/trains/10/stations/{KELETI}")).json()
    assert second == first
