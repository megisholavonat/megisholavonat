import json
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from typing import Any

import fakeredis
import httpx
import numpy as np
import polyline  # type: ignore[import-untyped]
import pytest
import pytz
from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.redis import add_key
from api.forecast import gbm, serve
from api.forecast.dataset import examples_from_rows
from api.forecast.features import (
    FEATURES,
    Examples,
    History,
    daytype,
    feature_matrix,
    product_code,
)
from api.forecast.model import FORMAT_VERSION, ForecastModel, Source
from api.forecast.train import (
    MODELS_KEPT,
    TrainConfig,
    TrainResult,
    evaluate,
    save_model,
    train,
)
from api.models.forecast import DelayForecastModel
from api.models.history import Stop, StopDelayObservation
from api.services import train_service
from api.services.history import ensure_partition
from api.services.train_service import TrainService

BUDAPEST = pytz.timezone("Europe/Budapest")
DAY = date(2026, 8, 14)
LAT = 47.0
STOP_LONS = [19.0, 19.1, 19.2, 19.3]
# 10:00, 10:05, 10:10, 10:15
STOP_TIMES = [10 * 3600 + i * 300 for i in range(4)]


def _unix(hh: int, mm: int, ss: int = 0) -> int:
    return int(BUDAPEST.localize(datetime(2026, 8, 14, hh, mm, ss)).timestamp())


def _vehicle(lon: float, at: int, lat: float = LAT) -> dict[str, Any]:
    stoptimes = [
        {
            "stopPosition": i + 1,
            "scheduledArrival": t,
            "realtimeArrival": t + 60,
            "scheduledDeparture": t,
            "realtimeDeparture": t + 120,
            "stop": {
                "gtfsId": f"1:00550000{i}_1",
                "name": f"Stop {i}",
                "lat": LAT,
                "lon": stop_lon,
                "platformCode": "1",
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
            "serviceDate": DAY.isoformat(),
            "tripShortName": "2512 személyvonat",
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
    [processed] = service.process_locations([_vehicle(lon, at, lat)])
    return processed


def _passage(
    trip: str, seq: int, delay: int, now: int, short: str = "2512 személyvonat"
) -> tuple[Any, ...]:
    # (trip, seq, short, station, sched_arr, sched_dep, delay, otp_dep, now)
    t = STOP_TIMES[seq] if seq < len(STOP_TIMES) else 10 * 3600 + seq * 300
    return (trip, seq, short, f"st{seq}", t, t, delay, delay + 30, now)


# --- features ---


def test_product_codes() -> None:
    assert product_code("2512 személyvonat") == 4
    assert product_code("H5 HÉV") == 1
    assert product_code("1946 KISKUN InterRégió") == 5
    assert product_code("900 BAKONY InterCity") == 6
    assert product_code("123 something") == 0


def test_daytype_counts_public_holidays_as_sunday() -> None:
    assert daytype(date(2026, 8, 14)) == 5  # Friday
    assert daytype(date(2026, 8, 20)) == 7  # St Stephen's Day, a Thursday


def test_examples_pair_each_passage_with_later_ones() -> None:
    # Passed stop 0 at 10:01 two minutes late, then stops 1-3
    rows = [
        _passage("1:a", 0, 120, 10 * 3600 + 60),
        _passage("1:a", 1, 180, 10 * 3600 + 300 + 180),
        _passage("1:a", 2, 240, 10 * 3600 + 600 + 240),
        _passage("1:a", 3, 300, 10 * 3600 + 900 + 300),
    ]
    ex = examples_from_rows(DAY, rows)

    assert len(ex) == 6
    c = ex.cols
    first = (c["origin_seq"] == 0) & (c["target_seq"] == 1)
    # Due at stop 1 at 10:05 + 2 min, seen at 10:01 -> 6 minutes ahead
    assert c["horizon_s"][first][0] == 360
    assert c["delay_s"][first][0] == 120
    assert c["otp_delay_s"][first][0] == 150
    assert c["sched_remaining_s"][first][0] == 300
    assert c["hour"][first][0] == 10
    assert c["daytype"][first][0] == 5
    assert c["product"][first][0] == 4
    assert ex.target_s is not None
    assert ex.target_s[first][0] == 180
    # Only the last recorded stop counts as the terminus
    assert set(c["target_seq"][c["is_terminus"] == 1]) == {3}


def test_examples_drop_past_and_far_targets() -> None:
    rows = [
        _passage("1:a", 0, 0, 10 * 3600),
        # Target scheduled 5 hours later: beyond MAX_HORIZON_S
        ("1:a", 1, "2512 személyvonat", "st1", 15 * 3600, 15 * 3600, 0, 0, 15 * 3600),
        _passage("1:b", 0, 0, 10 * 3600),
        # Recorded before the origin passage: not a future target
        _passage("1:b", 1, 0, 10 * 3600 - 60),
    ]

    assert len(examples_from_rows(DAY, rows)) == 0


def _synthetic(n: int, seed: int = 0) -> Examples:
    """Examples where the delay grows by 30 s per 5 minutes on train A and
    shrinks on train B."""
    rng = np.random.default_rng(seed)
    horizon = rng.integers(0, 3600, n).astype(float)
    delay = rng.integers(0, 600, n).astype(float)
    train_b = rng.random(n) < 0.5
    change = np.where(train_b, -1, 1) * horizon / 10 + rng.normal(0, 10, n)
    cols = {
        "delay_s": delay,
        "otp_delay_s": np.where(rng.random(n) < 0.1, np.nan, delay),
        "horizon_s": horizon,
        "sched_remaining_s": horizon,
        "origin_seq": np.zeros(n),
        "target_seq": np.ones(n),
        "hour": np.full(n, 8.0),
        "daytype": np.full(n, 2.0),
        "product": np.full(n, 4.0),
        "is_terminus": np.zeros(n),
    }
    return Examples(
        cols=cols,
        short_key=np.where(train_b, 2, 1).astype(np.uint64),
        station_key=np.full(n, 7, dtype=np.uint64),
        target_s=delay + change,
    )


def test_history_falls_back_to_coarser_levels() -> None:
    ex = _synthetic(2000)
    hist = History.fit(ex)

    _, level = hist.predict(ex)
    assert set(level) == {1}
    unknown = ex.take(np.arange(10))
    unknown.short_key = np.full(10, 99, dtype=np.uint64)
    _, level = hist.predict(unknown)
    assert set(level) == {2}
    unknown.station_key = np.full(10, 99, dtype=np.uint64)
    _, level = hist.predict(unknown)
    assert set(level) == {3}


# --- trees ---


def test_gbm_learns_a_step_and_missing_values() -> None:
    rng = np.random.default_rng(0)
    X = rng.random((5000, 2))
    X[:500, 1] = np.nan
    y = np.where(X[:, 0] > 0.5, 100.0, 0.0) + np.where(np.isnan(X[:, 1]), 50, 0)

    model = gbm.fit(X, y, n_trees=60, depth=3, learning_rate=0.3)

    err = np.abs(model.predict(X) - y)
    assert np.median(err) < 5
    assert model.predict(np.array([[0.9, np.nan]]))[0] == pytest.approx(150, abs=10)


def test_gbm_arrays_roundtrip() -> None:
    rng = np.random.default_rng(1)
    X = rng.random((500, 3))
    model = gbm.fit(X, X[:, 0] * 10, n_trees=10, depth=4)

    again = gbm.ObliviousGBM.from_arrays(model.to_arrays())

    np.testing.assert_array_equal(again.predict(X), model.predict(X))


def _model(n_trees: int = 30) -> ForecastModel:
    ex = _synthetic(4000)
    hist = History.fit(ex)
    hv, hl = hist.predict(ex)
    assert ex.target_s is not None
    trees = gbm.fit(
        feature_matrix(ex, hv, hl),
        ex.target_s - ex.cols["delay_s"],
        n_trees=n_trees,
        depth=4,
        learning_rate=0.3,
    )
    return ForecastModel(hist, trees)


def test_model_beats_constant_on_synthetic_data() -> None:
    model = _model()
    ex = _synthetic(2000, seed=5)
    assert ex.target_s is not None

    pred, source = model.predict(ex)

    assert set(source) == {Source.MODEL}
    const_mae = np.abs(ex.cols["delay_s"] - ex.target_s).mean()
    assert np.abs(pred - ex.target_s).mean() < const_mae / 3


# --- fallbacks ---


def test_falls_back_to_history_when_inference_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model = _model(5)
    ex = _synthetic(50, seed=2)
    hist, _ = model.history.predict(ex)

    def boom(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("broken trees")

    assert model.gbm is not None
    monkeypatch.setattr(model.gbm, "predict", boom)
    pred, source = model.predict(ex)

    assert set(source) == {Source.HISTORY}
    np.testing.assert_allclose(pred, ex.cols["delay_s"] + hist)


def test_falls_back_per_row_on_non_finite_predictions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model = _model(5)
    ex = _synthetic(4, seed=3)
    assert model.gbm is not None
    monkeypatch.setattr(
        model.gbm, "predict", lambda X: np.array([10.0, np.nan, np.inf, 1e9])
    )

    pred, source = model.predict(ex)

    assert list(source) == [Source.MODEL] + [Source.HISTORY] * 3
    assert pred[0] == ex.cols["delay_s"][0] + 10


def test_falls_back_to_constant_without_history() -> None:
    empty = History.fit(_synthetic(0))
    ex = _synthetic(20, seed=4)

    pred, source = ForecastModel(empty, None).predict(ex)

    assert set(source) == {Source.CONSTANT}
    np.testing.assert_array_equal(pred, ex.cols["delay_s"])


# --- serialisation ---


def test_model_bytes_roundtrip() -> None:
    model = _model(10)
    ex = _synthetic(100, seed=6)

    again = ForecastModel.from_bytes(model.to_bytes())

    np.testing.assert_array_equal(again.predict(ex)[0], model.predict(ex)[0])
    assert again.features == FEATURES


def test_model_bytes_reject_other_format(monkeypatch: pytest.MonkeyPatch) -> None:
    blob = _model(2).to_bytes()
    monkeypatch.setattr("api.forecast.model.FORMAT_VERSION", FORMAT_VERSION + 1)

    with pytest.raises(ValueError, match="format"):
        ForecastModel.from_bytes(blob)


# --- serving guards ---


def test_running_train_gets_upcoming_stops() -> None:
    # Two minutes late, between stops 0 and 1
    loc = _process(19.02, _unix(10, 3))

    ex, rows = serve.build_examples([loc])

    assert [r.stop_index for r in rows] == [1, 2, 3]
    assert list(ex.cols["is_terminus"]) == [0, 0, 1]
    assert ex.cols["origin_seq"][0] == 0
    assert ex.cols["otp_delay_s"][0] == 120
    assert ex.cols["delay_s"][0] == loc["delaySeconds"]


def test_skips_train_before_first_departure() -> None:
    loc = _process(19.0, _unix(9, 58))

    ex, rows = serve.build_examples([loc])

    assert len(ex) == 0
    assert rows == []


def test_skips_train_off_route() -> None:
    # ~1.1 km north of the line
    loc = _process(19.02, _unix(10, 3), lat=LAT + 0.01)
    assert loc["offRouteMeters"] > serve.MAX_OFF_ROUTE_M

    ex, _ = serve.build_examples([loc])

    assert len(ex) == 0


def test_annotate_without_model_uses_current_delay() -> None:
    loc = _process(19.02, _unix(10, 3))

    annotated = serve.annotate_locations([loc], None)

    assert annotated == 3
    by_index = {s["index"]: s.get("predictedDelay") for s in loc["processedStops"]}
    current = round(loc["delaySeconds"] / 60)
    assert by_index == {0: None, 1: current, 2: current, 3: current}


def test_annotate_with_model() -> None:
    loc = _process(19.02, _unix(10, 3))

    serve.annotate_locations([loc], _model(5))

    assert all(
        isinstance(s.get("predictedDelay"), int)
        for s in loc["processedStops"]
        if s["index"] > 0
    )


# --- storage ---


def _result(model: ForecastModel) -> TrainResult:
    return TrainResult(model, DAY, DAY, {"holdout": {}})


async def test_cache_loads_latest_stored_model(db_session: AsyncSession) -> None:
    first = await save_model(db_session, _result(_model(2)))
    second = await save_model(db_session, _result(_model(3)))

    @asynccontextmanager
    async def factory() -> Any:
        yield db_session

    cache = serve.ModelCache(factory)  # type: ignore[arg-type]
    model = await cache.get()

    assert second > first
    assert cache.model_id == second
    assert model is not None
    assert model.gbm is not None
    assert model.gbm.n_trees == 3
    # Within the check interval the database is not asked again
    await save_model(db_session, _result(_model(4)))
    assert await cache.get() is model


async def test_old_models_are_pruned(db_session: AsyncSession) -> None:
    for _ in range(MODELS_KEPT + 2):
        await save_model(db_session, _result(_model(1)))

    count = await db_session.scalar(
        select(func.count()).select_from(DelayForecastModel)
    )

    assert count == MODELS_KEPT


async def test_cache_keeps_serving_when_loading_fails() -> None:
    def broken() -> Any:
        raise ConnectionError("database down")

    cache = serve.ModelCache(broken, check_interval_s=0)  # type: ignore[arg-type]

    assert await cache.get() is None


# --- refresh integration ---


async def test_refresh_adds_predicted_delays(
    client: httpx.AsyncClient, redis: fakeredis.FakeAsyncRedis
) -> None:
    await TrainService(redis).refresh_data()

    raw = await redis.hgetall(add_key("train-positions-hash"))  # type: ignore[misc]
    predicted = {
        vid: [s for s in json.loads(v)["processedStops"] if "predictedDelay" in s]
        for vid, v in raw.items()
    }
    vehicle_id = next(vid for vid, stops in predicted.items() if stops)

    body = (await client.get(f"/v1/trains/{vehicle_id}")).json()

    last = body["vehicleProgress"]["lastStopIndex"]
    for stop in body["processedStops"]:
        if stop["index"] <= last:
            assert stop["predictedDelay"] is None
    assert any(isinstance(s["predictedDelay"], int) for s in body["processedStops"])


async def test_refresh_survives_forecast_failure(
    redis: fakeredis.FakeAsyncRedis, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def boom(locations: list[dict[str, Any]]) -> int:
        raise RuntimeError("forecast exploded")

    monkeypatch.setattr(train_service, "annotate_with_latest_model", boom)

    await TrainService(redis).refresh_data()

    assert await redis.hlen(add_key("train-positions-hash")) > 0  # type: ignore[misc]


# --- training end to end ---


async def _insert_history(session: AsyncSession, days: int) -> None:
    rng = np.random.default_rng(0)
    stops = [
        {"gtfs_id": f"1:00550000{i}_1", "station_id": f"00550000{i}", "name": f"S{i}"}
        for i in range(4)
    ]
    await session.execute(
        insert(Stop), [{**s, "lat": LAT, "lon": 19.0, "county": None} for s in stops]
    )
    rows = []
    for n in range(days):
        day = DAY + timedelta(days=n)
        await ensure_partition(session, day)
        midnight = BUDAPEST.localize(datetime.combine(day, datetime.min.time()))
        for t in range(12):
            delay = int(rng.integers(0, 300))
            for seq, sched in enumerate(STOP_TIMES):
                sched += t * 1800
                delay += 60 if t % 2 else -20
                rows.append(
                    {
                        "service_date": day,
                        "trip_gtfs_id": f"1:{t}",
                        "stop_sequence": seq,
                        "trip_short_name": f"{2500 + t} személyvonat",
                        "route_short_name": "S1",
                        "stop_id": stops[seq]["gtfs_id"],
                        "station_id": stops[seq]["station_id"],
                        "scheduled_arrival_s": sched,
                        "scheduled_departure_s": sched,
                        "delay_s": delay,
                        "otp_arrival_delay_s": None,
                        "otp_departure_delay_s": delay,
                        "observed_at": midnight + timedelta(seconds=sched + delay + 30),
                    }
                )
    await session.execute(insert(StopDelayObservation), rows)
    await session.flush()


async def test_training_end_to_end(db_session: AsyncSession) -> None:
    await _insert_history(db_session, days=10)
    cfg = TrainConfig(days=10, holdout_days=2, n_trees=20, depth=3, max_rows=5000)

    result = await train(db_session, DAY + timedelta(days=9), cfg)  # type: ignore[arg-type]

    holdout = result.metrics["holdout"]
    assert result.metrics["train_dates"] == ["2026-08-14", "2026-08-21"]
    assert result.metrics["holdout_dates"] == ["2026-08-22", "2026-08-23"]
    ten = holdout["10"]
    assert ten["n"] > 0
    # Odd trains gain a minute per stop, even ones lose 20 s: history and the
    # trees know, the constant baseline does not
    assert ten["history"]["mae_min"] < ten["constant"]["mae_min"]
    assert ten["model"]["mae_min"] < ten["constant"]["mae_min"]
    model_id = await save_model(db_session, result)
    stored = await db_session.get(DelayForecastModel, model_id)
    assert stored is not None
    assert ForecastModel.from_bytes(stored.artifact).gbm is not None


def test_evaluate_reports_each_horizon() -> None:
    ex = _synthetic(3000)
    assert ex.target_s is not None

    out = evaluate(ex, {"perfect": ex.target_s, "constant": ex.cols["delay_s"]})

    assert set(out) == {"10", "30", "60"}
    assert out["30"]["perfect"] == {"mae_min": 0.0, "within_2min": 1.0}
    assert out["30"]["constant"]["mae_min"] > 0
