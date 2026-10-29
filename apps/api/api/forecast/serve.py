"""
Live forecasts: after each refresh, annotate every running train's upcoming
processed stops with `predictedDelay` (minutes).

Everything here is best effort. The refresh calls `annotate_locations` inside
a try/except, model loading errors keep the previous model (or none), and
without a model the history tables and finally the current delay are used.
"""

import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from typing import Any

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.db import SessionLocal
from api.core.logging_config import get_logger
from api.forecast.features import (
    COLUMNS,
    MAX_HORIZON_S,
    Examples,
    daytype,
    product_code,
    stable_hash,
)
from api.forecast.model import FORMAT_VERSION, ForecastModel
from api.models.forecast import DelayForecastModel
from api.util.delay import to_minutes
from api.util.history_constants import MAX_ABS_DELAY_S, MAX_OFF_ROUTE_M
from api.util.stop import station_id
from api.util.trip import seconds_into_service_day

logger = get_logger(__name__)

# How often a worker checks for a newer model
MODEL_CHECK_INTERVAL_S = 10 * 60
# How far ahead of its timetable a train leaving a stop on time can get on the
# way to a later one: timetable padding, mostly before the terminus. In the
# history of 2026-10-15..29, after an on-time departure 95% of trains were at
# most 1 min early at any later stop, the terminus included (where 2-5% were
# a minute or more early). A long run may gain a little more.
MAX_EARLY_S = 60
MAX_EARLY_SHARE = 0.05


@dataclass
class _Row:
    loc: int  # index into the locations list
    stop_index: int
    # Lowest delay (seconds) the train can have there: it cannot pass the stop
    # before now, nor, while standing at a stop, leave it early and then gain
    # more than the padding of its timetable
    floor_s: float


def _floor(now_s: int, sched: int, dwell_dep: int | None, at_dwell_stop: bool) -> float:
    """The lowest delay at a stop due at `sched`: `dwell_dep` is the departure
    of the stop the train stands at, if any."""
    floor = float(now_s - sched)
    if dwell_dep is None:
        return floor
    left = max(now_s - dwell_dep, 0)
    if at_dwell_stop:
        return max(floor, float(left))
    early = max(MAX_EARLY_S, MAX_EARLY_SHARE * (sched - dwell_dep))
    return max(floor, left - early)


@lru_cache(maxsize=8192)
def _hash(value: str) -> int:
    return int(stable_hash([value])[0])


@lru_cache(maxsize=64)
def _daytype(service_date: str) -> float:
    try:
        return float(daytype(date.fromisoformat(service_date)))
    except ValueError:
        return float("nan")


def _origin(location: dict[str, Any]) -> tuple[int, int, int] | None:
    """(now in service-day seconds, last passed stop index, delay seconds) for a
    vehicle that is running its trip, or None if a guard rejects it."""
    trip = location.get("trip") or {}
    stoptimes = trip.get("stoptimes") or []
    last_updated = location.get("lastUpdated")
    delay_s = location.get("delaySeconds")
    last_idx = (location.get("vehicleProgress") or {}).get("lastStopIndex")
    off_route = location.get("offRouteMeters")
    if (
        not stoptimes
        or not trip.get("serviceDate")
        or last_updated is None
        or delay_s is None
        or last_idx is None
        or not 0 <= last_idx < len(stoptimes)
    ):
        return None
    if off_route is None or off_route > MAX_OFF_ROUTE_M:
        return None
    if abs(delay_s) > MAX_ABS_DELAY_S:
        return None
    first_dep = stoptimes[0].get("scheduledDeparture")
    now_s = seconds_into_service_day(trip, last_updated)
    # Not yet departed from its origin (vehicles are attached to trips early)
    if first_dep is None or now_s < first_dep:
        return None
    return now_s, last_idx, int(delay_s)


def build_examples(
    locations: list[dict[str, Any]],
) -> tuple[Examples, list[_Row]]:
    """One example per (running vehicle, upcoming stop within MAX_HORIZON_S)."""
    cols: dict[str, list[float]] = {k: [] for k in COLUMNS}
    short_keys: list[int] = []
    station_keys: list[int] = []
    rows: list[_Row] = []
    nan = float("nan")
    for n, loc in enumerate(locations):
        origin = _origin(loc)
        if origin is None:
            continue
        now_s, last_idx, delay_s = origin
        trip = loc["trip"]
        stoptimes = trip["stoptimes"]
        final = len(stoptimes) - 1
        o = stoptimes[last_idx]
        o_dep, o_rt = o.get("scheduledDeparture"), o.get("realtimeDeparture")
        otp = nan if o_dep is None or o_rt is None else float(o_rt - o_dep)
        short = trip.get("tripShortName") or ""
        short_key = _hash(short)
        product = float(product_code(short))
        hour = float((now_s // 3600) % 24)
        day = _daytype(trip["serviceDate"])
        # Standing at a stop it leaves on time at the earliest, and the run
        # from there takes about its scheduled time
        dwell_index = loc.get("dwellStopIndex")
        dwell_dep = (
            stoptimes[dwell_index].get("scheduledDeparture")
            if dwell_index is not None and 0 <= dwell_index < len(stoptimes)
            else None
        )
        for j in range(last_idx + 1, final + 1):
            st = stoptimes[j]
            sched = st.get("scheduledArrival" if j == final else "scheduledDeparture")
            station = station_id(st.get("stop") or {})
            if sched is None or station is None:
                continue
            horizon = sched + delay_s - now_s
            if horizon > MAX_HORIZON_S:
                break
            cols["delay_s"].append(delay_s)
            cols["otp_delay_s"].append(otp)
            cols["horizon_s"].append(max(horizon, 0))
            cols["sched_remaining_s"].append(
                nan if o_dep is None else float(sched - o_dep)
            )
            cols["origin_seq"].append(last_idx)
            cols["target_seq"].append(j)
            cols["hour"].append(hour)
            cols["daytype"].append(day)
            cols["product"].append(product)
            cols["is_terminus"].append(float(j == final))
            short_keys.append(short_key)
            station_keys.append(_hash(station))
            floor = _floor(now_s, sched, dwell_dep, j == dwell_index)
            rows.append(_Row(n, j, floor))
    ex = Examples(
        cols={k: np.asarray(v, dtype=np.float64) for k, v in cols.items()},
        short_key=np.asarray(short_keys, dtype=np.uint64),
        station_key=np.asarray(station_keys, dtype=np.uint64),
    )
    return ex, rows


def annotate_locations(
    locations: list[dict[str, Any]], model: ForecastModel | None
) -> int:
    """
    Set `predictedDelay` (whole minutes) on the upcoming processedStops of
    each running vehicle, in place. Returns the number of stops annotated.
    Without a model every upcoming stop keeps the current delay.
    """
    ex, rows = build_examples(locations)
    if model is None:
        pred = ex.cols["delay_s"]
    else:
        pred, _ = model.predict(ex)
    by_loc: dict[int, dict[int, int]] = {}
    for row, p in zip(rows, pred.tolist(), strict=True):
        by_loc.setdefault(row.loc, {})[row.stop_index] = to_minutes(max(p, row.floor_s))
    annotated = 0
    for n, predictions in by_loc.items():
        for stop in locations[n].get("processedStops") or []:
            value = predictions.get(stop.get("index"))
            if value is not None:
                stop["predictedDelay"] = value
                annotated += 1
    return annotated


# --- model loading ---


class ModelCache:
    """Latest model of this FORMAT_VERSION, re-checked every few minutes."""

    def __init__(
        self,
        session_factory: Callable[[], AsyncSession] = SessionLocal,
        check_interval_s: float = MODEL_CHECK_INTERVAL_S,
    ) -> None:
        self.session_factory = session_factory
        self.check_interval_s = check_interval_s
        self.model: ForecastModel | None = None
        self.model_id: int | None = None
        self.checked_at: float | None = None

    async def get(self) -> ForecastModel | None:
        now = time.monotonic()
        if (
            self.checked_at is not None
            and now - self.checked_at < self.check_interval_s
        ):
            return self.model
        self.checked_at = now
        try:
            async with self.session_factory() as session:
                latest = (
                    await session.execute(
                        select(DelayForecastModel.id)
                        .where(DelayForecastModel.format_version == FORMAT_VERSION)
                        .order_by(DelayForecastModel.id.desc())
                        .limit(1)
                    )
                ).scalar()
                if latest is None or latest == self.model_id:
                    return self.model
                blob = (
                    await session.execute(
                        select(DelayForecastModel.artifact).where(
                            DelayForecastModel.id == latest
                        )
                    )
                ).scalar_one()
            self.model = ForecastModel.from_bytes(blob)
            self.model_id = latest
            logger.info(f"Forecast: loaded model {latest}")
        except Exception as e:
            logger.error(f"Forecast: could not load model, keeping current: {e}")
        return self.model


model_cache = ModelCache()


async def annotate_with_latest_model(locations: list[dict[str, Any]]) -> int:
    # Looked up at call time so tests can swap the cache
    cache = model_cache
    start = time.perf_counter()
    model = await cache.get()
    annotated = annotate_locations(locations, model)
    logger.info(
        f"Forecast: {annotated} stops predicted with model {cache.model_id} "
        f"(Time: {time.perf_counter() - start:.4f}s)"
    )
    return annotated
