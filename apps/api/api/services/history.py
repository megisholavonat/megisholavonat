"""
Delay history: detect stops a train has passed and record one row per
(service date, trip, stop) into the partitioned stop_delay_observations table.

The detection works on processed locations (the output of
TrainService.process_locations), so the live recorder and offline replays share
the same passing-stop logic and the same GPS delay.
"""

import json
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Protocol

from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from api.core.config import settings
from api.core.logging_config import get_logger
from api.core.redis import add_key
from api.models.history import (
    ON_TIME_THRESHOLD_S,
    Stop,
    StopDelayObservation,
)
from api.util.preprocess import haversine_m
from api.util.stop import station_id
from api.util.trip import (
    IN_SERVICE_BEFORE_S,
    scheduled_window,
    seconds_into_service_day,
)

logger = get_logger(__name__)

# The vehicle must be this far (in route-projection degrees, ~230-330 m) past a
# stop before it counts as passed, so a long train standing at the platform
# with its GPS ahead of the stop point is not recorded as departed.
PASSED_MARGIN_DEG = 0.003
# A train never gets past its terminus: it stops short of the stop point, and
# the feed's last report before the vehicle vanishes or moves on to its next
# trip typically puts it ~50 m before the stop. So on the final leg, being this
# close to the terminus counts as arrived...
TERMINUS_RADIUS_M = 150
# ... and so does standing (speed 0 or unknown) this close to it
TERMINUS_STANDING_RADIUS_M = 500
# Positions further than this from the trip geometry belong to another trip
# (vehicles are pre-assigned to their next trip) or are GPS noise.
MAX_OFF_ROUTE_M = 500
# Only record a stop if, by the schedule, the train passed it at most this long
# ago; otherwise (GPS gap, or first sighting mid-route) the current delay says
# little about the delay at that stop.
MAX_RECORD_LAG_S = 10 * 60
# Delays beyond this are data errors
MAX_ABS_DELAY_S = 6 * 3600

WATERMARK_TTL_S = 2 * 24 * 3600

PARTITIONED_TABLE = StopDelayObservation.__tablename__

TripKey = tuple[str, str]  # (service date ISO, trip gtfsId)


@dataclass(frozen=True)
class Passage:
    row: dict[str, Any]
    stop: dict[str, Any]


def _otp_delay(realtime: int | None, scheduled: int | None) -> int | None:
    if realtime is None or scheduled is None:
        return None
    return realtime - scheduled


def _reached_terminus(location: dict[str, Any], stoptimes: list[Any]) -> bool:
    """
    Whether a train on its final leg is at the terminus: within
    TERMINUS_RADIUS_M of it (or TERMINUS_STANDING_RADIUS_M when standing), and
    closer to it than to the previous stop, so a train still calling there is
    not taken for arrived where the two are close together.
    """
    final_idx = len(stoptimes) - 1
    progress = location.get("vehicleProgress") or {}
    if final_idx < 1 or progress.get("nextStopIndex") != final_idx:
        return False
    lat, lon = location.get("lat"), location.get("lon")
    final = stoptimes[final_idx].get("stop") or {}
    previous = stoptimes[final_idx - 1].get("stop") or {}
    if (
        lat is None
        or lon is None
        or final.get("lat") is None
        or final.get("lon") is None
    ):
        return False
    distance = haversine_m(lat, lon, final["lat"], final["lon"])
    if (
        previous.get("lat") is not None
        and previous.get("lon") is not None
        and haversine_m(lat, lon, previous["lat"], previous["lon"]) <= distance
    ):
        return False
    standing = not location.get("speed")
    return distance <= TERMINUS_RADIUS_M or (
        standing and distance <= TERMINUS_STANDING_RADIUS_M
    )


def detect_passages(
    location: dict[str, Any], watermark: int | None
) -> tuple[list[Passage], int | None]:
    """
    Return the stops this observation newly shows as passed, and the new
    watermark (highest stoptime index known to be passed, or None).
    `watermark` is the value from the previous observation of the same trip.
    """
    trip = location.get("trip") or {}
    trip_id = trip.get("gtfsId")
    service_date = trip.get("serviceDate")
    stoptimes = trip.get("stoptimes") or []
    progress = location.get("vehicleProgress") or {}
    last_idx = progress.get("lastStopIndex")
    last_updated = location.get("lastUpdated")
    delay_s = location.get("delaySeconds")
    if (
        not trip_id
        or not service_date
        or not stoptimes
        or last_idx is None
        or last_updated is None
        or delay_s is None
    ):
        return [], watermark

    now_s = seconds_into_service_day(trip, last_updated)
    window = scheduled_window(trip)
    # Vehicle already attached to a trip it is not running yet
    if window is None or now_s < window[0] - IN_SERVICE_BEFORE_S:
        return [], watermark
    off_route = location.get("offRouteMeters")
    if off_route is None or off_route > MAX_OFF_ROUTE_M:
        return [], watermark
    if abs(delay_s) > MAX_ABS_DELAY_S:
        return [], watermark

    at_end = progress.get("nextStopIndex") == last_idx and progress.get("progress") == 1
    last_stop = next(
        (s for s in location.get("processedStops", []) if s.get("index") == last_idx),
        None,
    )
    if last_stop is None:
        return [], watermark
    beyond = location.get("trainPosition", 0.0) - last_stop["distanceAlongRoute"]
    passed_upto = last_idx if at_end or beyond >= PASSED_MARGIN_DEG else last_idx - 1
    final_idx = len(stoptimes) - 1
    if _reached_terminus(location, stoptimes):
        passed_upto = final_idx

    start = 0 if watermark is None else watermark + 1
    # Where the train is right now, in schedule time
    schedule_now = now_s - delay_s
    observed_at = datetime.fromtimestamp(last_updated, tz=UTC)
    route = trip.get("route") or {}

    passages = []
    for i in range(start, passed_upto + 1):
        st = stoptimes[i]
        stop = st.get("stop") or {}
        if not stop.get("gtfsId"):
            continue
        station = station_id(stop)
        sched_arr = st.get("scheduledArrival")
        sched_dep = st.get("scheduledDeparture")
        reference = sched_arr if i == final_idx else sched_dep
        if reference is None or schedule_now - reference > MAX_RECORD_LAG_S:
            continue

        passages.append(
            Passage(
                row={
                    "service_date": date.fromisoformat(service_date),
                    "trip_gtfs_id": trip_id,
                    "stop_sequence": i,
                    "gtfs_stop_sequence": st.get("stopPosition"),
                    "trip_short_name": trip.get("tripShortName") or "",
                    "route_short_name": route.get("shortName") or "",
                    "stop_id": stop["gtfsId"],
                    "station_id": station,
                    "scheduled_arrival_s": sched_arr,
                    "scheduled_departure_s": sched_dep,
                    "delay_s": delay_s,
                    "otp_arrival_delay_s": _otp_delay(
                        st.get("realtimeArrival"), sched_arr
                    ),
                    "otp_departure_delay_s": _otp_delay(
                        st.get("realtimeDeparture"), sched_dep
                    ),
                    "platform": stop.get("platformCode"),
                    "observed_at": observed_at,
                },
                stop={
                    "gtfs_id": stop["gtfsId"],
                    "station_id": station,
                    "name": stop.get("name") or "",
                    "lat": stop.get("lat") or 0.0,
                    "lon": stop.get("lon") or 0.0,
                    "county": stop.get("county"),
                },
            )
        )

    new_watermark = max(passed_upto, -1 if watermark is None else watermark)
    return passages, new_watermark


# --- Watermarks ---


class WatermarkStore(Protocol):
    async def get_many(self, keys: Iterable[TripKey]) -> dict[TripKey, int]: ...

    async def set_many(self, values: dict[TripKey, int]) -> None: ...


class MemoryWatermarks:
    """In-process watermarks, for offline replays."""

    def __init__(self) -> None:
        self.values: dict[TripKey, int] = {}

    async def get_many(self, keys: Iterable[TripKey]) -> dict[TripKey, int]:
        return {k: self.values[k] for k in keys if k in self.values}

    async def set_many(self, values: dict[TripKey, int]) -> None:
        self.values.update(values)


class RedisWatermarks:
    """One Redis hash per service date: trip gtfsId -> highest passed index."""

    def __init__(self, redis: Redis) -> None:
        self.redis = redis

    @staticmethod
    def _key(service_date: str) -> str:
        return add_key(f"history-watermarks:{service_date}")

    async def get_many(self, keys: Iterable[TripKey]) -> dict[TripKey, int]:
        dates = {d for d, _ in keys}
        result: dict[TripKey, int] = {}
        for d in dates:
            raw = await self.redis.hgetall(self._key(d))  # type: ignore[misc]
            result.update({(d, trip): int(v) for trip, v in raw.items()})
        return result

    async def set_many(self, values: dict[TripKey, int]) -> None:
        by_date: dict[str, dict[str, int]] = {}
        for (d, trip), v in values.items():
            by_date.setdefault(d, {})[trip] = v
        for d, mapping in by_date.items():
            await self.redis.hset(self._key(d), mapping=mapping)  # type: ignore[misc]
            await self.redis.expire(self._key(d), WATERMARK_TTL_S)


# --- Partitions ---


def month_start(d: date) -> date:
    return d.replace(day=1)


def add_months(d: date, months: int) -> date:
    index = d.year * 12 + d.month - 1 + months
    return date(index // 12, index % 12 + 1, 1)


def partition_name(month: date) -> str:
    return f"{PARTITIONED_TABLE}_y{month.year:04d}m{month.month:02d}"


async def ensure_partition(conn: AsyncConnection | AsyncSession, d: date) -> bool:
    """Create the monthly partition holding `d` if missing. True if created."""
    month = month_start(d)
    name = partition_name(month)
    exists = (
        await conn.execute(text("SELECT to_regclass(:name)"), {"name": name})
    ).scalar()
    if exists:
        return False
    await conn.execute(
        text(
            f"CREATE TABLE IF NOT EXISTS {name} PARTITION OF {PARTITIONED_TABLE} "
            f"FOR VALUES FROM ('{month.isoformat()}') "
            f"TO ('{add_months(month, 1).isoformat()}')"
        )
    )
    logger.info(f"Created partition {name}")
    return True


async def list_partitions(conn: AsyncConnection | AsyncSession) -> list[str]:
    result = await conn.execute(
        text(
            "SELECT c.relname FROM pg_inherits i "
            "JOIN pg_class c ON c.oid = i.inhrelid "
            "JOIN pg_class p ON p.oid = i.inhparent "
            "WHERE p.relname = :parent ORDER BY c.relname"
        ),
        {"parent": PARTITIONED_TABLE},
    )
    return [r[0] for r in result]


async def drop_old_partitions(
    conn: AsyncConnection | AsyncSession, today: date, keep_months: int
) -> list[str]:
    """Drop partitions whose whole month is older than `keep_months` months."""
    cutoff = add_months(month_start(today), -keep_months)
    dropped = []
    for name in await list_partitions(conn):
        suffix = name.removeprefix(f"{PARTITIONED_TABLE}_y")
        try:
            month = date(int(suffix[:4]), int(suffix[5:7]), 1)
        except ValueError:
            continue
        if month < cutoff:
            await conn.execute(text(f"DROP TABLE {name}"))
            dropped.append(name)
            logger.info(f"Dropped partition {name}")
    return dropped


# --- Recording ---

INSERT_CHUNK = 1000  # rows per statement, well under the bind parameter limit


async def store_passages(session: AsyncSession, passages: list[Passage]) -> int:
    """Upsert stops and insert observations. Returns rows inserted. Commits."""
    if not passages:
        return 0

    # Rows are written in key order, so concurrent writers (overlapping
    # recorder runs, parallel backfills) lock them in the same order and
    # cannot deadlock
    stops = {p.stop["gtfs_id"]: p.stop for p in passages}
    stmt = insert(Stop).values([stops[k] for k in sorted(stops)])
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=[Stop.gtfs_id],
            set_={
                "name": stmt.excluded.name,
                "station_id": stmt.excluded.station_id,
                "lat": stmt.excluded.lat,
                "lon": stmt.excluded.lon,
                "county": stmt.excluded.county,
            },
        )
    )

    for d in {p.row["service_date"] for p in passages}:
        await ensure_partition(session, d)

    inserted = 0
    rows = sorted(
        (p.row for p in passages),
        key=lambda r: (r["service_date"], r["trip_gtfs_id"], r["stop_sequence"]),
    )
    for i in range(0, len(rows), INSERT_CHUNK):
        chunk = rows[i : i + INSERT_CHUNK]
        result = await session.execute(
            insert(StopDelayObservation)
            .values(chunk)
            .on_conflict_do_nothing()
            .returning(StopDelayObservation.stop_sequence)
        )
        inserted += len(result.all())

    await session.commit()
    return inserted


async def record_locations(
    session: AsyncSession,
    watermarks: WatermarkStore,
    locations: Iterable[dict[str, Any]],
) -> int:
    """Detect passages in processed locations, store them, advance watermarks."""
    locations = [
        loc
        for loc in locations
        if (loc.get("trip") or {}).get("gtfsId")
        and (loc.get("trip") or {}).get("serviceDate")
    ]
    keys = [(loc["trip"]["serviceDate"], loc["trip"]["gtfsId"]) for loc in locations]
    current = await watermarks.get_many(keys)

    passages: list[Passage] = []
    updates: dict[TripKey, int] = {}
    for key, loc in zip(keys, locations, strict=True):
        found, new_wm = detect_passages(loc, updates.get(key, current.get(key)))
        passages.extend(found)
        if new_wm is not None and new_wm != current.get(key):
            updates[key] = new_wm

    inserted = await store_passages(session, passages)
    # Only after the rows are committed, so a failed insert is retried next run
    await watermarks.set_many(updates)
    return inserted


async def record_from_cache(redis: Redis, session: AsyncSession) -> int:
    """Record passages from the processed locations the last refresh cached."""
    raw = await redis.hgetall(add_key("train-positions-hash"))  # type: ignore[misc]
    locations = [json.loads(v) for v in raw.values()]
    inserted = await record_locations(session, RedisWatermarks(redis), locations)
    logger.info(
        f"History: recorded {inserted} stop passages from {len(locations)} vehicles"
    )
    return inserted


# --- Daily maintenance ---


async def rollup_day(session: AsyncSession, day: date) -> int:
    """(Re)build delay_daily_agg (per station) for one service date. Idempotent."""
    await session.execute(
        text("DELETE FROM delay_daily_agg WHERE service_date = :d"), {"d": day}
    )
    result = await session.execute(
        text(
            """
            INSERT INTO delay_daily_agg (
                service_date, station_id, route_short_name,
                n, n_on_time, sum_delay_s, p90_delay_s, max_delay_s
            )
            SELECT
                service_date, station_id, route_short_name,
                count(*),
                count(*) FILTER (WHERE delay_s <= :on_time),
                sum(delay_s),
                round(percentile_cont(0.9) WITHIN GROUP (ORDER BY delay_s)),
                max(delay_s)
            FROM stop_delay_observations
            WHERE service_date = :d
            GROUP BY service_date, station_id, route_short_name
            """
        ),
        {"d": day, "on_time": ON_TIME_THRESHOLD_S},
    )
    await session.commit()
    return int(result.rowcount or 0)  # type: ignore[attr-defined]


async def run_maintenance(session: AsyncSession, today: date) -> dict[str, Any]:
    """
    Daily job: make sure this and next month's partitions exist, roll
    yesterday up into delay_daily_agg, drop partitions past retention.
    """
    created = [
        partition_name(m)
        for m in (month_start(today), add_months(month_start(today), 1))
        if await ensure_partition(session, m)
    ]
    await session.commit()

    yesterday = today - timedelta(days=1)
    aggregated = await rollup_day(session, yesterday)

    dropped = await drop_old_partitions(
        session, today, settings.HISTORY_RETENTION_MONTHS
    )
    await session.commit()

    summary = {
        "created": created,
        "aggregated_day": yesterday.isoformat(),
        "aggregate_rows": aggregated,
        "dropped": dropped,
    }
    logger.info(f"History maintenance: {summary}")
    return summary
