"""
Read side of the delay history: typical delays per train and station,
punctuality rankings and on-time share by hour.

Everything is aggregated in SQL over stop_delay_observations, using our
GPS-derived delay_s. Statistics cover a window of service dates that ends at
the latest recorded service date (see `history_window`).
"""

import json
from datetime import date, datetime, timedelta
from typing import Any

import pytz
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.history import ON_TIME_THRESHOLD_S
from api.schemas.insights import (
    DelayStats,
    HistoryWindow,
    HourPunctuality,
    RankingEntry,
    RankingKind,
    RankingOrder,
    Rankings,
    TimeOfDayPunctuality,
    TrainHistory,
    TrainRouteStation,
    TrainStationHistory,
)
from api.util.route_names import MAV_ROUTE_MAP, route_name

BUDAPEST_TZ = pytz.timezone("Europe/Budapest")

# Below this many passages a delay statistic is flagged as insufficient
MIN_SAMPLES = 5
# A station belongs to a train's usual route if at least this share of the
# train's runs were recorded there
USUAL_ROUTE_MIN_SHARE = 0.5

# Train numbers are the first token of the trip short name ("10 TRANSCARPATHIA")
TRAIN_NUMBER = "split_part(trip_short_name, ' ', 1)"
IN_WINDOW = "service_date BETWEEN :start AND :end"

# Delay aggregates over a set of observations
DELAY_AGGREGATES = """
    count(*) AS n,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY delay_s) AS median_s,
    percentile_cont(0.8) WITHIN GROUP (ORDER BY delay_s) AS p80_s,
    avg((delay_s <= :on_time)::int) AS on_time_share
"""


def _minutes(seconds: float | None) -> float | None:
    return None if seconds is None else round(seconds / 60, 1)


def _share(value: Any) -> float | None:
    return None if value is None else round(float(value), 3)


def _stats(row: Any) -> dict[str, Any]:
    """DelayStats fields from a row with DELAY_AGGREGATES columns."""
    n = int(row.n) if row is not None else 0
    if n == 0:
        return {"n": 0, "insufficientData": True}
    return {
        "n": n,
        "medianDelayMin": _minutes(row.median_s),
        "p80DelayMin": _minutes(row.p80_s),
        "onTimeShare": _share(row.on_time_share),
        "insufficientData": n < MIN_SAMPLES,
    }


async def history_window(session: AsyncSession, days: int) -> HistoryWindow:
    """
    The last `days` service dates up to the latest one with recorded data
    (today if there is none), so a gap in recording does not empty the window.
    """
    latest = (
        await session.execute(
            text("SELECT max(service_date) FROM stop_delay_observations")
        )
    ).scalar()
    end: date = latest or datetime.now(BUDAPEST_TZ).date()
    return HistoryWindow(start=end - timedelta(days=days - 1), end=end, days=days)


def _window_params(window: HistoryWindow) -> dict[str, Any]:
    return {
        "start": window.start,
        "end": window.end,
        "on_time": ON_TIME_THRESHOLD_S,
    }


async def station_names(
    session: AsyncSession, station_ids: list[str]
) -> dict[str, str]:
    if not station_ids:
        return {}
    result = await session.execute(
        text(
            "SELECT station_id, min(name) FROM stops "
            "WHERE station_id = ANY(:ids) GROUP BY station_id"
        ),
        {"ids": station_ids},
    )
    return {r[0]: r[1] for r in result}


# Most common platform per group; ties go to the most recently used platform
TOP_PLATFORM = """
    platforms AS (
        SELECT {group} AS grp, platform,
               count(*) AS c, max(observed_at) AS last_seen
        FROM obs
        WHERE platform IS NOT NULL
        GROUP BY 1, 2
    ),
    top_platform AS (
        SELECT DISTINCT ON (grp)
               grp, platform, c, sum(c) OVER (PARTITION BY grp) AS total
        FROM platforms
        ORDER BY grp, c DESC, last_seen DESC, platform
    )
"""


async def train_station_history(
    session: AsyncSession, train_number: str, station: str, days: int
) -> TrainStationHistory:
    window = await history_window(session, days)
    params = {**_window_params(window), "train": train_number, "station": station}
    obs = f"""
        obs AS (
            SELECT * FROM stop_delay_observations
            WHERE {IN_WINDOW} AND station_id = :station
              AND {TRAIN_NUMBER} = :train
        )
    """

    stats = await session.execute(
        text(
            f"""
            WITH {obs}
            SELECT extract(isodow FROM service_date) >= 6 AS weekend,
                   grouping(extract(isodow FROM service_date) >= 6) AS total,
                   {DELAY_AGGREGATES}
            FROM obs
            GROUP BY GROUPING SETS ((), (extract(isodow FROM service_date) >= 6))
            """
        ),
        params,
    )
    overall = weekday = weekend = None
    for row in stats:
        if row.total:
            overall = row
        elif row.weekend:
            weekend = row
        else:
            weekday = row

    platform = (
        await session.execute(
            text(
                f"WITH {obs}, {TOP_PLATFORM.format(group='1')} "
                "SELECT platform FROM top_platform"
            ),
            params,
        )
    ).scalar()
    names = await station_names(session, [station])

    return TrainStationHistory(
        trainNumber=train_number,
        stationId=station,
        stationName=names.get(station),
        window=window,
        typicalPlatform=platform,
        weekday=DelayStats(**_stats(weekday)),
        weekend=DelayStats(**_stats(weekend)),
        **_stats(overall),
    )


async def train_history(
    session: AsyncSession, train_number: str, days: int
) -> TrainHistory:
    window = await history_window(session, days)
    params = {
        **_window_params(window),
        "train": train_number,
        "min_share": USUAL_ROUTE_MIN_SHARE,
    }
    result = await session.execute(
        text(
            f"""
            WITH obs AS (
                SELECT * FROM stop_delay_observations
                WHERE {IN_WINDOW} AND {TRAIN_NUMBER} = :train
            ),
            runs AS (
                SELECT count(DISTINCT (service_date, trip_gtfs_id)) AS runs FROM obs
            ),
            {TOP_PLATFORM.format(group="station_id")},
            per_station AS (
                SELECT station_id,
                       count(DISTINCT (service_date, trip_gtfs_id)) AS station_runs,
                       percentile_disc(0.5) WITHIN GROUP (
                           ORDER BY coalesce(scheduled_departure_s, scheduled_arrival_s)
                       ) AS scheduled_s,
                       {DELAY_AGGREGATES}
                FROM obs
                GROUP BY station_id
            )
            SELECT s.*, r.runs, p.platform
            FROM per_station s
            CROSS JOIN runs r
            LEFT JOIN top_platform p ON p.grp = s.station_id
            WHERE s.station_runs >= CAST(:min_share AS float8) * r.runs
            ORDER BY s.scheduled_s NULLS LAST, s.station_id
            """
        ),
        params,
    )
    rows = result.all()

    names_row = (
        await session.execute(
            text(
                f"""
                SELECT trip_short_name, route_short_name, count(DISTINCT trip_gtfs_id)
                FROM stop_delay_observations
                WHERE {IN_WINDOW} AND {TRAIN_NUMBER} = :train
                GROUP BY 1, 2
                ORDER BY 3 DESC, 1, 2
                LIMIT 1
                """
            ),
            params,
        )
    ).first()
    names = await station_names(session, [r.station_id for r in rows])

    return TrainHistory(
        trainNumber=train_number,
        tripShortName=names_row[0] if names_row else None,
        routeShortName=(names_row[1] or None) if names_row else None,
        lineName=route_name(names_row[1]) if names_row else None,
        window=window,
        runs=rows[0].runs if rows else 0,
        stations=[
            TrainRouteStation(
                stationId=r.station_id,
                stationName=names.get(r.station_id),
                scheduledTimeS=r.scheduled_s,
                typicalPlatform=r.platform,
                **_stats(r),
            )
            for r in rows
        ],
    )


# Line name of a route shortName in SQL, like api.util.route_names.route_name:
# the MNR2007 glyph code looked up in :route_map, else the text without tags
LINE_NAME = (
    "coalesce(CAST(:route_map AS jsonb) ->> "
    "substring(route_short_name FROM '&#([0-9]+);'), "
    "regexp_replace(route_short_name, '<[^>]+>', '', 'g'))"
)
ROUTE_MAP_JSON = json.dumps({str(k): v for k, v in MAV_ROUTE_MAP.items()})

RANKING_KEYS: dict[str, str] = {
    "stations": "station_id",
    "lines": LINE_NAME,
    "trains": TRAIN_NUMBER,
}


async def rankings(
    session: AsyncSession,
    kind: RankingKind,
    order: RankingOrder,
    days: int,
    limit: int,
    min_samples: int,
) -> Rankings:
    window = await history_window(session, days)
    key = RANKING_KEYS[kind]
    # best: most on time first, then the smallest median delay
    direction = "DESC" if order == "best" else "ASC"
    tiebreak = "ASC" if order == "best" else "DESC"
    params = {**_window_params(window), "min_samples": min_samples, "limit": limit}
    if kind == "lines":
        params["route_map"] = ROUTE_MAP_JSON
    result = await session.execute(
        text(
            f"""
            SELECT {key} AS id, {DELAY_AGGREGATES},
                   mode() WITHIN GROUP (ORDER BY trip_short_name) AS trip_short_name,
                   mode() WITHIN GROUP (ORDER BY route_short_name) AS route_short_name
            FROM stop_delay_observations
            WHERE {IN_WINDOW} AND {key} <> ''
            GROUP BY 1
            HAVING count(*) >= :min_samples
            ORDER BY on_time_share {direction}, median_s {tiebreak}, n DESC, id
            LIMIT :limit
            """
        ),
        params,
    )
    rows = result.all()

    names: dict[str, str] = {}
    if kind == "stations":
        names = await station_names(session, [r.id for r in rows])
    elif kind == "lines":
        names = {r.id: r.id for r in rows}
    else:
        # The most common full name, e.g. "10 TRANSCARPATHIA"
        names = {r.id: r.trip_short_name for r in rows}

    return Rankings(
        kind=kind,
        order=order,
        minSamples=min_samples,
        window=window,
        entries=[
            RankingEntry(
                rank=i + 1,
                id=r.id,
                name=names.get(r.id),
                routeShortName=None if kind == "stations" else r.route_short_name,
                n=r.n,
                onTimeShare=_share(r.on_time_share) or 0.0,
                medianDelayMin=_minutes(r.median_s) or 0.0,
            )
            for i, r in enumerate(rows)
        ],
    )


async def time_of_day(
    session: AsyncSession, station: str | None, days: int
) -> TimeOfDayPunctuality:
    window = await history_window(session, days)
    station_filter = "AND station_id = :station" if station else ""
    result = await session.execute(
        text(
            f"""
            SELECT (coalesce(scheduled_departure_s, scheduled_arrival_s) / 3600) % 24
                       AS hour,
                   {DELAY_AGGREGATES}
            FROM stop_delay_observations
            WHERE {IN_WINDOW} {station_filter}
              AND coalesce(scheduled_departure_s, scheduled_arrival_s) IS NOT NULL
            GROUP BY 1
            """
        ),
        {**_window_params(window), "station": station},
    )
    by_hour = {int(r.hour): r for r in result}
    hours = []
    for hour in range(24):
        stats = _stats(by_hour.get(hour))
        hours.append(
            HourPunctuality(
                hour=hour,
                n=stats["n"],
                onTimeShare=stats.get("onTimeShare"),
                medianDelayMin=stats.get("medianDelayMin"),
            )
        )
    return TimeOfDayPunctuality(stationId=station, window=window, hours=hours)
