"""
Connection risk: how likely delays break a transfer.

A transfer from train A to train B is missed when B leaves less than
MIN_TRANSFER_S after A arrives, i.e. when A's delay beyond B's exceeds the
slack: the planned buffer minus any walk and MIN_TRANSFER_S.

Each train's delay at the transfer station comes from
- the live forecast, when the train is running and the station is within the
  forecast horizon: the predicted delay plus the forecast's error spread at
  that horizon (RESIDUALS_S), or
- the train's own delays at that station over the last HISTORY_DAYS; for the
  arriving train smoothed towards all trains at the station.
The two delays are taken as independent. Departure delays below zero count
as zero: trains do not leave early.

The probability maps to three levels. The error spread was measured and the
levels checked against missed connections in the delay history (Aug-Sep 2026):
"safe" transfers were missed 1% of the time, "tight" ones 17%, and "likely
missed" ones 66%.
"""

import json
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
import numpy.typing as npt
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.logging_config import get_logger
from api.core.redis import add_key
from api.schemas.journeys import (
    CityLeg,
    ConnectionRisk,
    ConnectionRiskSource,
    Itinerary,
    Transfer,
    TransitLeg,
    WalkLeg,
)
from api.services.history_sql import IN_WINDOW, TRAIN_NUMBER, window_params
from api.util.history_constants import DEFAULT_HISTORY_DAYS
from api.util.stop import station_id
from api.util.trip import seconds_into_service_day

logger = get_logger(__name__)

MIN_TRANSFER_S = 2 * 60
HISTORY_DAYS = DEFAULT_HISTORY_DAYS
# Pseudo-observations of the station-wide distribution mixed into a train's own
PRIOR_WEIGHT = 4

SAFE_BELOW = 0.1
LIKELY_MISSED_FROM = 0.5

# Forecast error (actual - predicted delay, seconds) by the expected time
# until the train reaches the station; quantiles measured on Aug 29 - Sep 2
# for a model trained on the days before
HORIZON_BANDS_S = (
    (0, 15 * 60),
    (15 * 60, 30 * 60),
    (30 * 60, 60 * 60),
    (60 * 60, 120 * 60),
    (120 * 60, 10**9),
)
RESIDUAL_QUANTILES = (
    0.01, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99,
)  # fmt: skip
RESIDUALS_S: tuple[tuple[int, ...], ...] = (
    (-124, -62, -42, -24, -14, -5, 4, 14, 26, 43, 79, 141, 385),
    (-281, -145, -94, -50, -26, -9, 9, 29, 59, 110, 227, 364, 804),
    (-401, -207, -132, -64, -33, -13, 7, 35, 81, 164, 325, 524, 1241),
    (-645, -352, -247, -135, -69, -25, 15, 77, 168, 301, 545, 865, 2127),
    (-875, -578, -440, -253, -144, -66, -14, 54, 165, 330, 680, 1060, 1945),
)
# Station-wide delay distribution, as percentiles
PRIOR_PERCENTILES = tuple(round(p / 100, 2) for p in range(1, 100))

IntArray = npt.NDArray[np.integer]
FloatArray = npt.NDArray[np.floating]


# --- probabilities ---


def _share_above(sorted_samples: npt.NDArray[Any], x: float) -> float:
    n = sorted_samples.size
    return float(n - np.searchsorted(sorted_samples, x, side="right")) / n


def miss_probability_from_history(
    samples: npt.NDArray[Any],
    prior: npt.NDArray[Any],
    slack_s: float,
    departure_samples: npt.NDArray[Any] | None = None,
) -> float | None:
    """
    Share of past arrival delays (seconds, sorted) beyond the slack, with
    PRIOR_WEIGHT pseudo-observations from `prior` (all trains at the station,
    sorted). With `departure_samples`, the departing train's delays are
    averaged over. None without any data.
    """
    if samples.size == 0 and prior.size == 0:
        return None

    def p_at(x: float) -> float:
        if prior.size == 0:
            return _share_above(samples, x)
        p_prior = _share_above(prior, x)
        if samples.size == 0:
            return p_prior
        k = samples.size - np.searchsorted(samples, x, side="right")
        return float((k + PRIOR_WEIGHT * p_prior) / (samples.size + PRIOR_WEIGHT))

    if departure_samples is None or departure_samples.size == 0:
        return p_at(slack_s)
    return float(
        np.mean([p_at(slack_s + max(float(b), 0.0)) for b in departure_samples])
    )


def horizon_band(horizon_s: float) -> int:
    for i, (lo, hi) in enumerate(HORIZON_BANDS_S):
        if lo <= horizon_s < hi:
            return i
    return 0 if horizon_s < 0 else len(HORIZON_BANDS_S) - 1


def forecast_spread(
    predicted_delay_s: float,
    horizon_s: float,
    residuals: Sequence[Sequence[int]] = RESIDUALS_S,
) -> FloatArray:
    """A forecast as samples: the prediction plus each error quantile."""
    return predicted_delay_s + np.asarray(
        residuals[horizon_band(horizon_s)], dtype=np.float64
    )


def miss_probability_from_forecast(
    predicted_delay_s: float,
    horizon_s: float,
    slack_s: float,
    departure_samples: npt.NDArray[Any] | None = None,
    residuals: Sequence[Sequence[int]] = RESIDUALS_S,
) -> float:
    """
    P(predicted delay + forecast error > slack + the departing train's delay),
    averaged over `departure_samples` (its forecast spread or past delays).
    """
    quantiles = np.asarray(residuals[horizon_band(horizon_s)], dtype=np.float64)
    departures = (
        np.zeros(1)
        if departure_samples is None or departure_samples.size == 0
        else np.maximum(departure_samples, 0)
    )
    threshold = slack_s + departures - predicted_delay_s
    below = np.interp(threshold, quantiles, RESIDUAL_QUANTILES, left=0.0, right=1.0)
    return float(1.0 - np.mean(below))


def risk_level(probability: float) -> ConnectionRisk:
    if probability >= LIKELY_MISSED_FROM:
        return "likely_missed"
    if probability >= SAFE_BELOW:
        return "tight"
    return "safe"


# --- live forecasts ---


@dataclass(frozen=True)
class LiveForecast:
    delay_s: float  # predicted (or, once passed, current) delay at the station
    horizon_s: float  # expected seconds until the train gets there


def live_forecast(
    location: dict[str, Any], station: str | None, scheduled: int, now: float
) -> LiveForecast | None:
    """
    The forecast of a live train at a station, from the `predictedDelay` of
    its processed stops. `scheduled` (unix seconds) picks the right call if
    the trip passes the station twice. None if the station is not predicted.
    """
    trip = location.get("trip") or {}
    stoptimes = trip.get("stoptimes") or []
    calls = [
        i
        for i, st in enumerate(stoptimes)
        if station is not None and station_id(st.get("stop") or {}) == station
    ]
    if not calls:
        return None
    target = seconds_into_service_day(trip, scheduled)

    def distance(i: int) -> int:
        st = stoptimes[i]
        t = st.get("scheduledDeparture") or st.get("scheduledArrival") or 0
        return abs(int(t) - target)

    index = min(calls, key=distance)
    last = (location.get("vehicleProgress") or {}).get("lastStopIndex")
    delay_s = location.get("delaySeconds")
    if last is not None and index <= last and delay_s is not None:
        # Already there or past it: the current delay is what happened
        return LiveForecast(float(delay_s), 0.0)
    for stop in location.get("processedStops") or []:
        if stop.get("index") == index and stop.get("predictedDelay") is not None:
            predicted = float(stop["predictedDelay"]) * 60
            return LiveForecast(predicted, max(scheduled + predicted - now, 0.0))
    return None


async def load_live_locations(
    redis: Redis, vehicle_ids: Sequence[str]
) -> dict[str, dict[str, Any]]:
    if not vehicle_ids:
        return {}
    raws = await redis.hmget(add_key("train-positions-hash"), list(vehicle_ids))  # type: ignore[misc]
    return {
        vid: json.loads(raw)
        for vid, raw in zip(vehicle_ids, raws, strict=True)
        if raw is not None
    }


# --- history ---

HistoryKey = tuple[str, str]  # (train number, station)


@dataclass
class DelayHistory:
    # Sorted delays (seconds) of a train at a station
    trains: dict[HistoryKey, IntArray]
    # Percentiles of all delays at a station
    stations: dict[str, IntArray]

    def train(self, key: HistoryKey) -> IntArray:
        return self.trains.get(key, np.empty(0, dtype=np.int64))

    def station(self, station: str) -> IntArray:
        return self.stations.get(station, np.empty(0, dtype=np.int64))


async def load_delay_history(
    session: AsyncSession,
    keys: set[HistoryKey],
    prior_stations: set[str],
    start: Any,
    end: Any,
) -> DelayHistory:
    trains: dict[HistoryKey, IntArray] = {}
    stations: dict[str, IntArray] = {}
    window = window_params(start, end)
    if keys:
        rows = await session.execute(
            text(
                f"""
                SELECT {TRAIN_NUMBER} AS train, station_id,
                       array_agg(delay_s ORDER BY delay_s) AS delays
                FROM stop_delay_observations
                WHERE {IN_WINDOW}
                  AND station_id = ANY(:stations)
                  AND {TRAIN_NUMBER} = ANY(:trains)
                GROUP BY 1, 2
                """
            ),
            {
                **window,
                "stations": sorted({s for _, s in keys}),
                "trains": sorted({t for t, _ in keys}),
            },
        )
        for train, station, delays in rows:
            key = (str(train), str(station))
            if key in keys:
                trains[key] = np.asarray(delays, dtype=np.int64)
    if prior_stations:
        prior_rows = await session.execute(
            text(
                f"""
                SELECT station_id,
                       percentile_disc(CAST(:percentiles AS float8[]))
                           WITHIN GROUP (ORDER BY delay_s)
                FROM stop_delay_observations
                WHERE {IN_WINDOW}
                  AND station_id = ANY(:stations)
                GROUP BY 1
                """
            ),
            {
                **window,
                "stations": sorted(prior_stations),
                "percentiles": list(PRIOR_PERCENTILES),
            },
        )
        for station, percentiles in prior_rows:
            stations[str(station)] = np.asarray(percentiles, dtype=np.int64)
    return DelayHistory(trains, stations)


# --- transfers ---


@dataclass(frozen=True)
class _Change:
    transfer: Transfer
    arriving: TransitLeg
    departing: TransitLeg
    slack_s: int


def _changes(itineraries: Sequence[Itinerary]) -> list[_Change]:
    changes = []
    for itinerary in itineraries:
        for transfer in itinerary.transfers:
            arriving = itinerary.legs[transfer.fromLeg]
            departing = itinerary.legs[transfer.toLeg]
            assert isinstance(arriving, TransitLeg)
            assert isinstance(departing, TransitLeg)
            # Walks and city rides between the trains (a tram from one
            # station to another) take from the slack
            walk_s = sum(
                leg.arrivalTime - leg.departureTime
                if isinstance(leg, WalkLeg)
                else leg.scheduledArrival - leg.scheduledDeparture
                for leg in itinerary.legs[transfer.fromLeg + 1 : transfer.toLeg]
                if isinstance(leg, WalkLeg | CityLeg)
            )
            slack = (
                departing.scheduledDeparture
                - arriving.scheduledArrival
                - walk_s
                - MIN_TRANSFER_S
            )
            changes.append(_Change(transfer, arriving, departing, slack))
    return changes


def _set(transfer: Transfer, probability: float, source: ConnectionRiskSource) -> None:
    transfer.missRisk = round(probability, 3)
    transfer.risk = risk_level(probability)
    transfer.riskSource = source


async def assess_transfers(
    redis: Redis,
    session: AsyncSession,
    itineraries: Sequence[Itinerary],
    now: float,
    history_window: tuple[Any, Any],
) -> None:
    """Fill in the risk of every transfer, in place. Best effort: a transfer
    without forecast or history keeps no risk."""
    changes = _changes(itineraries)
    if not changes:
        return

    vehicle_ids = sorted(
        {
            leg.vehicleId
            for c in changes
            for leg in (c.arriving, c.departing)
            if leg.vehicleId
        }
    )
    try:
        locations = await load_live_locations(redis, vehicle_ids)
    except Exception as e:
        logger.error(f"Connection risk: live positions unavailable: {e}")
        locations = {}

    def forecast(leg: TransitLeg, station: str | None, scheduled: int) -> Any:
        location = locations.get(leg.vehicleId or "")
        if location is None:
            return None
        return live_forecast(location, station, scheduled, now)

    pending: list[tuple[_Change, LiveForecast | None, LiveForecast | None]] = []
    for c in changes:
        if c.arriving.canceled or c.departing.canceled:
            _set(c.transfer, 1.0, "canceled")
            continue
        pending.append(
            (
                c,
                forecast(c.arriving, c.arriving.toStop.id, c.arriving.scheduledArrival),
                forecast(
                    c.departing,
                    c.departing.fromStop.id,
                    c.departing.scheduledDeparture,
                ),
            )
        )

    keys: set[HistoryKey] = set()
    prior_stations: set[str] = set()
    for c, arrival, departure in pending:
        if arrival is None and c.arriving.toStop.id:
            keys.add((c.arriving.trainNumber, c.arriving.toStop.id))
            prior_stations.add(c.arriving.toStop.id)
        if departure is None and c.departing.fromStop.id:
            keys.add((c.departing.trainNumber, c.departing.fromStop.id))
    history = DelayHistory({}, {})
    if keys:
        try:
            history = await load_delay_history(
                session, keys, prior_stations, *history_window
            )
        except Exception as e:
            logger.error(f"Connection risk: delay history unavailable: {e}")
            await session.rollback()

    for c, arrival, departure in pending:
        if departure is not None:
            departures: npt.NDArray[Any] = forecast_spread(
                departure.delay_s, departure.horizon_s
            )
        elif c.departing.fromStop.id:
            departures = history.train(
                (c.departing.trainNumber, c.departing.fromStop.id)
            )
        else:
            departures = np.empty(0)

        if arrival is not None:
            probability: float | None = miss_probability_from_forecast(
                arrival.delay_s, arrival.horizon_s, c.slack_s, departures
            )
            source: ConnectionRiskSource = "forecast"
        else:
            station = c.arriving.toStop.id or ""
            probability = miss_probability_from_history(
                history.train((c.arriving.trainNumber, station)),
                history.station(station),
                c.slack_s,
                departures,
            )
            source = "history"
        if probability is not None:
            _set(c.transfer, probability, source)
