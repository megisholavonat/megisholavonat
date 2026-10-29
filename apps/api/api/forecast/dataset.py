"""
Training examples from stop_delay_observations.

Every recorded passage of stop i is an origin: the train has just passed i
with delay d at `observed_at`. Each later recorded passage j of the same trip
within MAX_HORIZON_S is a target. Days are loaded one at a time and turned
into numpy columns straight away, so memory stays proportional to the kept
examples, not to the raw rows.
"""

from datetime import date, timedelta
from typing import Any

import numpy as np
import numpy.typing as npt
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from api.forecast.features import (
    MAX_HORIZON_S,
    Examples,
    FloatArray,
    daytype,
    empty_examples,
    product_code,
    stable_hash,
)

# Delays outside this range are data errors (the research ground truth used
# the same bounds)
MIN_DELAY_S = -15 * 60
MAX_DELAY_S = 6 * 3600

# Stand-in for NULL in the numeric export
NULL = -(2**31)
# Numeric columns of one passage, in export order
NUMERIC = (
    "trip_no",  # dense rank of the trip within the day
    "stop_sequence",
    "short_no",  # index into the sorted distinct trip_short_names
    "station_no",  # index into the sorted distinct station_ids
    "scheduled_arrival_s",
    "scheduled_departure_s",
    "delay_s",
    "otp_departure_delay_s",
    "now_s",  # seconds into the service day (local noon - 12 h, as OTP counts)
)

# One row per day: the distinct names plus every passage as one flat string of
# integers. Far smaller than a Python object per row and column, and numpy
# parses it in one call.
DAY_QUERY = text(
    f"""
    WITH o AS (
        SELECT
            dense_rank() OVER (ORDER BY trip_gtfs_id) AS trip_no,
            stop_sequence,
            dense_rank() OVER (ORDER BY trip_short_name) - 1 AS short_no,
            dense_rank() OVER (ORDER BY station_id) - 1 AS station_no,
            scheduled_arrival_s,
            scheduled_departure_s,
            delay_s,
            otp_departure_delay_s,
            extract(epoch FROM observed_at - (
                (service_date + time '12:00') AT TIME ZONE 'Europe/Budapest'
                - interval '12 hours'
            ))::int AS now_s
        FROM stop_delay_observations
        WHERE service_date = :d
    )
    SELECT
        (SELECT array_agg(DISTINCT trip_short_name ORDER BY trip_short_name)
            FROM stop_delay_observations WHERE service_date = :d) AS shorts,
        (SELECT array_agg(DISTINCT station_id ORDER BY station_id)
            FROM stop_delay_observations WHERE service_date = :d) AS stations,
        (SELECT string_agg(
            concat_ws(',', {", ".join(f"coalesce({c}, {NULL})" for c in NUMERIC)}),
            ',' ORDER BY trip_no, stop_sequence
        ) FROM o) AS data
    """
)


def examples_from_rows(service_date: date, rows: list[tuple[Any, ...]]) -> Examples:
    """
    Examples from passage tuples (trip_gtfs_id, stop_sequence, trip_short_name,
    station_id, scheduled_arrival_s, scheduled_departure_s, delay_s,
    otp_departure_delay_s, now_s), sorted by trip and stop_sequence.
    """
    if not rows:
        return empty_examples(with_target=True)
    shorts = sorted({r[2] for r in rows})
    stations = sorted({r[3] for r in rows})
    trips = {t: n for n, t in enumerate(dict.fromkeys(r[0] for r in rows))}
    short_ix = {v: i for i, v in enumerate(shorts)}
    station_ix = {v: i for i, v in enumerate(stations)}
    data = np.array(
        [
            [trips[r[0]], r[1], short_ix[r[2]], station_ix[r[3]]]
            + [NULL if v is None else v for v in r[4:]]
            for r in rows
        ],
        dtype=np.int64,
    )
    return examples_from_arrays(service_date, data, shorts, stations)


def examples_from_arrays(
    service_date: date,
    data: npt.NDArray[np.int64],
    shorts: list[str],
    stations: list[str],
) -> Examples:
    """Pair up one service date's passages; `data` has the NUMERIC columns
    and is sorted by trip and stop_sequence."""
    if data.shape[0] == 0:
        return empty_examples(with_target=True)
    col = {name: data[:, i] for i, name in enumerate(NUMERIC)}

    def _float(name: str) -> FloatArray:
        v = col[name].astype(np.float64)
        v[col[name] == NULL] = np.nan
        return v

    n = data.shape[0]
    seq_a = col["stop_sequence"]
    s_arr_a, s_dep_a = _float("scheduled_arrival_s"), _float("scheduled_departure_s")
    delay_a, otp_a = _float("delay_s"), _float("otp_departure_delay_s")
    now_a = _float("now_s")
    trip_a = col["trip_no"]

    # Trip boundaries; the last recorded stop of a trip is taken as its terminus
    starts = np.flatnonzero(np.r_[True, trip_a[1:] != trip_a[:-1]])
    ends = np.r_[starts[1:], n]
    last_of_trip = np.zeros(n, dtype=bool)
    last_of_trip[ends - 1] = True
    sched_t = np.where(last_of_trip, s_arr_a, s_dep_a)

    origin_parts, target_parts = [], []
    for a, b in zip(starts, ends, strict=True):
        if b - a < 2:
            continue
        i, j = np.triu_indices(b - a, 1)
        origin_parts.append(i + a)
        target_parts.append(j + a)
    if not origin_parts:
        return empty_examples(with_target=True)
    oi, tj = np.concatenate(origin_parts), np.concatenate(target_parts)

    horizon = sched_t[tj] + delay_a[oi] - now_a[oi]
    keep = (
        (horizon >= 0)
        & (horizon <= MAX_HORIZON_S)
        & (now_a[tj] > now_a[oi])
        & (delay_a[oi] >= MIN_DELAY_S)
        & (delay_a[oi] <= MAX_DELAY_S)
        & (delay_a[tj] >= MIN_DELAY_S)
        & (delay_a[tj] <= MAX_DELAY_S)
    )
    oi, tj, horizon = oi[keep], tj[keep], horizon[keep]

    products = np.array([product_code(s) for s in shorts], dtype=np.float64)
    cols = {
        "delay_s": delay_a[oi],
        "otp_delay_s": otp_a[oi],
        "horizon_s": horizon,
        "sched_remaining_s": sched_t[tj] - s_dep_a[oi],
        "origin_seq": seq_a[oi].astype(np.float64),
        "target_seq": seq_a[tj].astype(np.float64),
        "hour": np.floor(now_a[oi] / 3600) % 24,
        "daytype": np.full(oi.size, float(daytype(service_date))),
        "product": products[col["short_no"][oi]],
        "is_terminus": last_of_trip[tj].astype(np.float64),
    }
    return Examples(
        cols=cols,
        short_key=stable_hash(shorts)[col["short_no"][oi]],
        station_key=stable_hash(stations)[col["station_no"][tj]],
        target_s=delay_a[tj],
    )


async def load_day(
    conn: AsyncConnection | AsyncSession, service_date: date
) -> Examples:
    row = (await conn.execute(DAY_QUERY, {"d": service_date})).one()
    shorts: list[str] = row[0] or []
    stations: list[str] = row[1] or []
    data: str | None = row[2]
    if not data:
        return empty_examples(with_target=True)
    values = np.fromstring(data, dtype=np.int64, sep=",")
    del data
    return examples_from_arrays(
        service_date, values.reshape(-1, len(NUMERIC)), shorts, stations
    )


async def available_dates(
    conn: AsyncConnection | AsyncSession, start: date, end: date
) -> list[date]:
    """Service dates in [start, end] that have observations."""
    result = await conn.execute(
        text(
            "SELECT DISTINCT service_date FROM stop_delay_observations "
            "WHERE service_date BETWEEN :s AND :e ORDER BY 1"
        ),
        {"s": start, "e": end},
    )
    return [r[0] for r in result]


def date_range(start: date, end: date) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]
