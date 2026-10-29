from datetime import UTC, date, datetime, timedelta
from typing import Any

import fakeredis
import httpx
import numpy as np
import pytest
import respx
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.history import Stop, StopDelayObservation
from api.services import connection_risk as cr
from api.services import insights
from api.services.history import ensure_partition
from tests.test_journeys import (
    DEPARTURE_79,
    JOURNEYS,
    KELETI,
    SZOLNOK,
    _plan,
    _store_live_trains,
)
from tests.upstream import graphql_route, otp_responder

TODAY = date(2026, 10, 29)
# 79 reaches Szolnok at 16:27 CET; 638 (or its 606 portion) leaves at 16:36
ARRIVAL_SZOLNOK_S = 16 * 3600 + 27 * 60
DEPARTURE_KELETI_S = 15 * 3600 + 5 * 60


def _sorted(values: list[int]) -> np.ndarray:
    return np.sort(np.asarray(values, dtype=np.int64))


# --- probabilities ---


def test_history_share_of_delays_beyond_the_slack() -> None:
    late = _sorted([600] * 3 + [0] * 7)
    assert cr.miss_probability_from_history(late, _sorted([]), 300) == 0.3
    assert cr.miss_probability_from_history(late, _sorted([]), 600) == 0.0


def test_history_is_smoothed_towards_the_station() -> None:
    # Two on-time runs alone would say "never missed"; the station says
    # half of all trains are late
    own = _sorted([0, 0])
    station = _sorted([0, 900])
    p = cr.miss_probability_from_history(own, station, 300)
    assert p == pytest.approx(cr.PRIOR_WEIGHT * 0.5 / (2 + cr.PRIOR_WEIGHT))
    # Without its own runs the station decides
    assert cr.miss_probability_from_history(_sorted([]), station, 300) == 0.5
    assert cr.miss_probability_from_history(_sorted([]), _sorted([]), 300) is None


def test_a_late_departing_train_lowers_the_risk() -> None:
    arrivals = _sorted([600] * 10)
    assert cr.miss_probability_from_history(arrivals, _sorted([]), 300) == 1.0
    # Half the time the connection leaves 10 min late too; early counts as 0
    departures = _sorted([600, 600, -120, 0])
    p = cr.miss_probability_from_history(
        arrivals, _sorted([]), 300, departure_samples=departures
    )
    assert p == 0.5


def test_forecast_probability_follows_the_error_spread() -> None:
    p = [
        cr.miss_probability_from_forecast(predicted, 10 * 60, 300)
        for predicted in (0, 240, 300, 360, 900)
    ]
    assert p == sorted(p)
    assert p[0] < 0.05
    assert p[2] == pytest.approx(0.5, abs=0.06)
    assert p[-1] == 1.0
    # Further ahead the same prediction is less certain
    near = cr.miss_probability_from_forecast(600, 5 * 60, 300)
    far = cr.miss_probability_from_forecast(600, 150 * 60, 300)
    assert near > far > 0.5


def test_levels() -> None:
    assert cr.risk_level(0.0) == "safe"
    assert cr.risk_level(0.099) == "safe"
    assert cr.risk_level(0.1) == "tight"
    assert cr.risk_level(0.49) == "tight"
    assert cr.risk_level(0.5) == "likely_missed"


# --- live forecasts ---


def _location(
    *,
    vehicle_id: str = "1:915504800123",
    trip_id: str = "1:36463704",
    last_stop: int = 0,
    predicted: int | None = 12,
    delay_s: int = 420,
) -> dict[str, Any]:
    stops = [
        {"gtfsId": f"1:{KELETI}_1", "stationUicPricingCode": KELETI},
        {"gtfsId": f"1:{SZOLNOK}_2", "stationUicPricingCode": SZOLNOK},
    ]
    processed: list[dict[str, Any]] = [{"index": 0}, {"index": 1}]
    if predicted is not None:
        processed[1]["predictedDelay"] = predicted
    return {
        "vehicleId": vehicle_id,
        "delay": round(delay_s / 60),
        "delaySeconds": delay_s,
        "trip": {
            "gtfsId": trip_id,
            "serviceDate": TODAY.isoformat(),
            "tripShortName": "79 MUNTENIA gyorsvonat",
            "stoptimes": [
                {
                    "stop": stops[0],
                    "scheduledArrival": DEPARTURE_KELETI_S,
                    "scheduledDeparture": DEPARTURE_KELETI_S,
                },
                {
                    "stop": stops[1],
                    "scheduledArrival": ARRIVAL_SZOLNOK_S,
                    "scheduledDeparture": ARRIVAL_SZOLNOK_S + 60,
                },
            ],
        },
        "vehicleProgress": {"lastStopIndex": last_stop},
        "processedStops": processed,
    }


ARRIVAL_79 = DEPARTURE_79 + ARRIVAL_SZOLNOK_S - DEPARTURE_KELETI_S


def test_live_forecast_at_the_station() -> None:
    now = ARRIVAL_79 - 20 * 60
    forecast = cr.live_forecast(_location(), SZOLNOK, ARRIVAL_79, now)
    assert forecast == cr.LiveForecast(12 * 60, 32 * 60)
    # Not predicted (beyond the horizon) or not on the trip
    assert cr.live_forecast(_location(predicted=None), SZOLNOK, ARRIVAL_79, now) is None
    assert cr.live_forecast(_location(), "005500000", ARRIVAL_79, now) is None


def test_live_forecast_once_the_train_is_there() -> None:
    location = _location(last_stop=1, predicted=None, delay_s=480)
    forecast = cr.live_forecast(location, SZOLNOK, ARRIVAL_79, ARRIVAL_79)
    assert forecast == cr.LiveForecast(480, 0)


# --- on the journeys ---


@pytest.fixture(autouse=True)
def _today(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(insights, "today", lambda: TODAY)


async def _seed_runs(
    session: AsyncSession, train: str, station: str, delays: list[int]
) -> None:
    rows: list[dict[str, Any]] = []
    days = [TODAY - timedelta(days=n) for n in range(1, len(delays) + 1)]
    for n, (day, delay) in enumerate(zip(days, delays, strict=True), start=1):
        rows.append(
            {
                "service_date": day,
                "trip_gtfs_id": f"1:{train}-{n}",
                "stop_sequence": 3,
                "trip_short_name": f"{train} TEST InterCity",
                "route_short_name": "IC",
                "stop_id": f"1:{station}_1",
                "station_id": station,
                "scheduled_arrival_s": ARRIVAL_SZOLNOK_S,
                "scheduled_departure_s": ARRIVAL_SZOLNOK_S + 60,
                "delay_s": delay,
                "platform": "1",
                "observed_at": datetime.combine(day, datetime.min.time(), tzinfo=UTC),
            }
        )
    await session.execute(
        insert(Stop)
        .values(
            gtfs_id=f"1:{station}_1",
            station_id=station,
            name=station,
            lat=47.0,
            lon=20.0,
        )
        .on_conflict_do_nothing()
    )
    for d in set(days):
        await ensure_partition(session, d)
    await session.execute(insert(StopDelayObservation).values(rows))
    await session.flush()


async def test_risk_from_history(
    client: httpx.AsyncClient, otp: respx.MockRouter, db_session: AsyncSession
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder(journeys=JOURNEYS))
    # 79 usually reaches Szolnok 15 minutes late; the connection leaves on time
    await _seed_runs(db_session, "79", SZOLNOK, [900] * 8 + [60] * 2)
    for connection in ("638", "606"):
        await _seed_runs(db_session, connection, SZOLNOK, [0] * 10)

    response = await _plan(client)

    (transfer,) = response.json()["itineraries"][0]["transfers"]
    assert transfer["transferMinutes"] == 9
    assert transfer["risk"] == "likely_missed"
    assert transfer["riskSource"] == "history"
    assert 0.5 <= transfer["missRisk"] < 1


async def test_on_time_history_is_safe(
    client: httpx.AsyncClient, otp: respx.MockRouter, db_session: AsyncSession
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder(journeys=JOURNEYS))
    await _seed_runs(db_session, "79", SZOLNOK, [60] * 20)

    response = await _plan(client)

    (transfer,) = response.json()["itineraries"][0]["transfers"]
    assert transfer["risk"] == "safe"
    assert transfer["missRisk"] == 0


async def test_risk_from_the_live_forecast(
    client: httpx.AsyncClient,
    otp: respx.MockRouter,
    redis: fakeredis.FakeAsyncRedis,
    db_session: AsyncSession,
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder(journeys=JOURNEYS))
    # History says on time, but today 79 is forecast 12 min late at Szolnok
    await _seed_runs(db_session, "79", SZOLNOK, [0] * 20)
    await _store_live_trains(redis, [_location()])

    response = await _plan(client)

    first = response.json()["itineraries"][0]
    assert first["legs"][0]["vehicleId"] == "1:915504800123"
    (transfer,) = first["transfers"]
    assert transfer["riskSource"] == "forecast"
    assert transfer["risk"] == "likely_missed"


async def test_no_data_no_risk(
    client: httpx.AsyncClient, otp: respx.MockRouter
) -> None:
    graphql_route(otp).mock(side_effect=otp_responder(journeys=JOURNEYS))

    response = await _plan(client)

    (transfer,) = response.json()["itineraries"][0]["transfers"]
    assert transfer["missRisk"] is None
    assert transfer["risk"] is None
