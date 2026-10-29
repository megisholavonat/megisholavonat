"""
Weekly training, run by the trainer image (a Kubernetes CronJob calling
`python -m api.forecast train`): load the last few weeks of
stop_delay_observations, hold out the most recent days, fit LightGBM, evaluate
against the constant and c1 baselines, and store the artifact.

LightGBM is only installed in the trainer (the `train` dependency group); the
API serves the exported JSON with api.forecast.trees.
"""

import asyncio
import time
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from typing import Any

import numpy as np
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from api.core.config import settings
from api.core.logging_config import get_logger
from api.forecast.dataset import available_dates, load_day
from api.forecast.features import (
    FEATURES,
    HISTORY_MIN_COUNT,
    Examples,
    FloatArray,
    History,
    HistoryTable,
    KeyArray,
    feature_matrix,
    history_keys,
    median_table,
    merge_tables,
)
from api.forecast.model import FORMAT_VERSION, ForecastModel
from api.forecast.trees import TreeEnsemble
from api.models.forecast import DelayForecastModel
from api.util.time import today

logger = get_logger(__name__)

# (lower, upper) seconds around each reported horizon, as in the research
HORIZON_BINS = {"10": (450, 750), "30": (1500, 2100), "60": (3000, 4200)}
MIN_TRAIN_DAYS = 7
MODELS_KEPT = 8
# The numpy evaluator must reproduce LightGBM's predictions this closely
# (seconds) on the holdout, or the model is not stored
MAX_PARITY_ERROR_S = 1e-3


class NotEnoughData(Exception):
    pass


@dataclass
class TrainConfig:
    days: int = 28
    holdout_days: int = 7
    # Examples the trees are fitted on (spread evenly over the training days);
    # bounds memory. History tables always use every example.
    max_rows: int = 1_000_000
    n_trees: int = 400
    num_leaves: int = 63
    # Bounds the serving cost: the evaluator steps all trees `max_depth` times
    max_depth: int = 10
    learning_rate: float = 0.08
    min_data_in_leaf: int = 200
    num_threads: int = 2
    history_folds: int = 4
    # History tables are built in this many passes over the data, each
    # holding one hash bucket of keys, to bound memory
    history_buckets: int = 8
    # Holdout examples evaluated (a random sample of them)
    max_eval_rows: int = 300_000
    seed: int = 0


@dataclass
class TrainResult:
    model: ForecastModel
    trained_from: date
    trained_to: date
    metrics: dict[str, Any] = field(default_factory=dict)


def evaluate(ex: Examples, predictions: dict[str, FloatArray]) -> dict[str, Any]:
    """MAE (minutes) and share within +-2 minutes per horizon bin and method."""
    if ex.target_s is None:
        raise ValueError("evaluation needs targets")
    out: dict[str, Any] = {}
    h = ex.cols["horizon_s"]
    for name, (lo, hi) in HORIZON_BINS.items():
        sel = (h >= lo) & (h <= hi)
        row: dict[str, Any] = {"n": int(sel.sum())}
        for method, pred in predictions.items():
            err = np.abs(pred[sel] - ex.target_s[sel]) / 60
            row[method] = {
                "mae_min": round(float(err.mean()), 3) if err.size else None,
                "within_2min": round(float((err <= 2).mean()), 4) if err.size else None,
            }
        out[name] = row
    return out


def _sample(ex: Examples, n: int, rng: np.random.Generator) -> Examples:
    if len(ex) <= n:
        return ex
    return ex.take(np.sort(rng.choice(len(ex), size=n, replace=False)))


def _change(ex: Examples) -> FloatArray:
    if ex.target_s is None:
        raise ValueError("training needs targets")
    return ex.target_s - ex.cols["delay_s"]


async def collect(
    conn: AsyncConnection,
    dates: list[date],
    day_sets: dict[str, list[date]],
    per_day: int,
    cfg: TrainConfig,
) -> tuple[dict[str, History], dict[date, Examples]]:
    """
    One History per named set of days, built from every example of those
    days, plus a sample of at most `per_day` examples per day for fitting.
    Each pass loads all days and keeps only one hash bucket of the keys.
    """
    rng = np.random.default_rng(cfg.seed)
    day_ix = {d: i for i, d in enumerate(dates)}
    set_ix = {name: np.array([day_ix[d] for d in ds]) for name, ds in day_sets.items()}
    parts: dict[str, list[tuple[HistoryTable, HistoryTable]]] = {
        n: [] for n in day_sets
    }
    samples: dict[date, Examples] = {}
    buckets = np.uint64(cfg.history_buckets)
    for bucket in range(cfg.history_buckets):
        levels: list[list[tuple[KeyArray, np.ndarray, np.ndarray]]] = [[], []]
        for d in dates:
            ex = await load_day(conn, d)
            if bucket == 0:
                samples[d] = _sample(ex, per_day, rng).compact()
            change = _change(ex).astype(np.float32)
            for keys, acc in zip(history_keys(ex)[:2], levels, strict=True):
                m = keys % buckets == bucket
                acc.append((keys[m], change[m], np.full(m.sum(), day_ix[d], np.int16)))
            del ex
        merged = [
            tuple(np.concatenate([p[i] for p in acc]) for i in range(3))
            for acc in levels
        ]
        del levels
        for name, ix in set_ix.items():
            tables = []
            for (keys, change, day), min_count in zip(
                merged, HISTORY_MIN_COUNT, strict=False
            ):
                m = np.isin(day, ix)
                tables.append(median_table(keys[m], change[m], min_count))
            parts[name].append((tables[0], tables[1]))
        del merged

    histories = {}
    for name, ds in day_sets.items():
        # The last level (horizon bucket only) is fine from the sample
        sample = Examples.concat([samples[d] for d in ds])
        level3 = median_table(
            history_keys(sample)[2], _change(sample), HISTORY_MIN_COUNT[2]
        )
        histories[name] = History(
            (
                merge_tables([p[0] for p in parts[name]]),
                merge_tables([p[1] for p in parts[name]]),
                level3,
            )
        )
    return histories, samples


def training_matrix(
    folds: list[list[date]],
    histories: dict[str, History],
    samples: dict[date, Examples],
) -> tuple[np.ndarray, FloatArray]:
    """Training samples, each day with the history of the other folds
    (out-of-fold), so the trees never see history containing the target."""
    n = sum(len(samples[d]) for group in folds for d in group)
    X = np.empty((n, len(FEATURES)), dtype=np.float32)
    y = np.empty(n, dtype=np.float64)
    row = 0
    for i, group in enumerate(folds):
        for d in group:
            ex = samples[d]
            hv, hl = histories[f"fold{i}"].predict(ex)
            feature_matrix(ex, hv, hl, out=X[row : row + len(ex)])
            y[row : row + len(ex)] = _change(ex)
            row += len(ex)
    return X, y


def fit_lightgbm(X: np.ndarray, y: FloatArray, cfg: TrainConfig) -> Any:
    """L1 LightGBM on the delay change. Every feature is numeric (product codes
    included), so the export has no categorical splits."""
    import lightgbm as lgb  # trainer image only

    params = {
        "objective": "l1",
        "learning_rate": cfg.learning_rate,
        "num_leaves": cfg.num_leaves,
        "max_depth": cfg.max_depth,
        "min_data_in_leaf": cfg.min_data_in_leaf,
        "feature_fraction": 0.8,
        "bagging_fraction": 0.8,
        "bagging_freq": 1,
        "num_threads": cfg.num_threads,
        "seed": cfg.seed,
        "verbose": -1,
    }
    data = lgb.Dataset(X, y, feature_name=list(FEATURES), free_raw_data=True)
    return lgb.train(params, data, num_boost_round=cfg.n_trees)


async def train(
    conn: AsyncConnection,
    end: date | None = None,
    cfg: TrainConfig | None = None,
    holdout_from: date | None = None,
) -> TrainResult:
    """
    Use service dates in (end - cfg.days, end]; `end` defaults to yesterday.
    The trees are fitted on all but the last `cfg.holdout_days` dates (or the
    dates before `holdout_from`) and evaluated on the rest. The stored model
    pairs those trees with history tables from the whole window.
    """
    cfg = cfg or TrainConfig()
    started = time.monotonic()
    if end is None:
        end = today() - timedelta(days=1)
    dates = await available_dates(conn, end - timedelta(days=cfg.days - 1), end)
    if holdout_from is not None:
        train_dates = [d for d in dates if d < holdout_from]
    else:
        train_dates = dates[: max(0, len(dates) - cfg.holdout_days)]
    holdout_dates = dates[len(train_dates) :]
    if len(train_dates) < MIN_TRAIN_DAYS or not holdout_dates:
        raise NotEnoughData(
            f"{len(train_dates)} training and {len(holdout_dates)} holdout days "
            f"up to {end}; need {MIN_TRAIN_DAYS} and 1"
        )

    n_folds = min(cfg.history_folds, len(train_dates))
    folds = [train_dates[i::n_folds] for i in range(n_folds)]
    day_sets = {
        **{
            f"fold{i}": [d for d in train_dates if d not in group]
            for i, group in enumerate(folds)
        },
        "train": train_dates,
        "all": dates,
    }
    per_day = cfg.max_rows // len(train_dates)
    histories, samples = await collect(conn, dates, day_sets, per_day, cfg)
    load_s = time.monotonic() - started
    logger.info(f"Forecast training: data and history ready ({load_s:.0f}s)")

    fit_started = time.monotonic()
    X, y = training_matrix(folds, histories, samples)
    booster = await asyncio.to_thread(fit_lightgbm, X, y, cfg)
    del X, y
    # The API gets flat arrays, never the (large) JSON dump
    trees = TreeEnsemble.from_dump(booster.dump_model())
    fit_s = time.monotonic() - fit_started

    holdout = _sample(
        Examples.concat([samples[d] for d in holdout_dates]),
        cfg.max_eval_rows,
        np.random.default_rng(cfg.seed),
    )
    evaluated = ForecastModel(histories["train"], trees)
    # The API evaluates the JSON export with numpy; it has to agree with
    # LightGBM itself before the model is stored
    hv, hl = histories["train"].predict(holdout)
    X_holdout = feature_matrix(holdout, hv, hl)
    assert evaluated.trees is not None
    parity = float(
        np.max(
            np.abs(evaluated.trees.predict(X_holdout) - booster.predict(X_holdout)),
            initial=0.0,
        )
    )
    del X_holdout
    if parity > MAX_PARITY_ERROR_S:
        raise RuntimeError(f"Exported trees disagree with LightGBM by {parity} s")
    metrics = evaluate(
        holdout,
        {
            "constant": holdout.cols["delay_s"],
            "history": ForecastModel(histories["train"], None).predict(holdout)[0],
            "model": evaluated.predict(holdout)[0],
        },
    )
    logger.info(f"Forecast holdout metrics: {metrics}")

    return TrainResult(
        model=ForecastModel(histories["all"], trees),
        trained_from=dates[0],
        trained_to=dates[-1],
        metrics={
            "holdout": metrics,
            "train_dates": [train_dates[0].isoformat(), train_dates[-1].isoformat()],
            "holdout_dates": [
                holdout_dates[0].isoformat(),
                holdout_dates[-1].isoformat(),
            ],
            "examples": {
                "fit": sum(len(samples[d]) for d in train_dates),
                "holdout": len(holdout),
                "history_keys": [int(t.keys.size) for t in histories["all"].tables],
            },
            "config": asdict(cfg),
            "parity_max_abs_error_s": parity,
            "trees": {
                "n": evaluated.trees.n_trees,
                "max_depth": evaluated.trees.depth,
            },
            "seconds": {
                "load": round(load_s, 1),
                "fit": round(fit_s, 1),
                "total": round(time.monotonic() - started, 1),
            },
        },
    )


def training_engine() -> Any:
    """Read-only engine for the training data (FORECAST_TRAINING_DATABASE_URL,
    by default the app database)."""
    return create_async_engine(
        settings.FORECAST_TRAINING_DATABASE_URL or settings.DATABASE_URL,
        poolclass=NullPool,
        connect_args={"server_settings": {"default_transaction_read_only": "on"}},
    )


async def save_model(session: AsyncSession, result: TrainResult) -> int:
    """Store the artifact, keep the newest MODELS_KEPT rows. Commits."""
    row = DelayForecastModel(
        format_version=FORMAT_VERSION,
        features=list(result.model.features),
        trained_from=result.trained_from,
        trained_to=result.trained_to,
        metrics=result.metrics,
        artifact=result.model.to_bytes(),
    )
    session.add(row)
    await session.flush()
    keep = (
        select(DelayForecastModel.id)
        .order_by(DelayForecastModel.id.desc())
        .limit(MODELS_KEPT)
    )
    await session.execute(
        delete(DelayForecastModel).where(DelayForecastModel.id.not_in(keep))
    )
    await session.commit()
    logger.info(f"Forecast: stored model {row.id} ({len(row.artifact)} bytes)")
    return row.id


async def train_and_store(
    session: AsyncSession,
    end: date | None = None,
    cfg: TrainConfig | None = None,
    holdout_from: date | None = None,
) -> dict[str, Any]:
    engine = training_engine()
    try:
        async with engine.connect() as conn:
            result = await train(conn, end, cfg, holdout_from)
    finally:
        await engine.dispose()
    model_id = await save_model(session, result)
    return {"model_id": model_id, **result.metrics}
