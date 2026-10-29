"""
Base layers of our own map style, built once a day and served as stored JSON.

- network: the passenger rail network as GeoJSON lines, each carrying how many
  trains run on it per day (from the OTP timetable of the day)
- stations: rail stations as GeoJSON points, ranked by how many trains we
  observed there per day (from the delay history)
"""

import asyncio
import hashlib
import json
import secrets
import time
from collections import defaultdict
from collections.abc import Awaitable, Callable, Iterable, Iterator
from dataclasses import dataclass
from datetime import date, timedelta
from itertools import pairwise
from typing import Any

import polyline  # type: ignore[import-untyped]
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.graphql import query_graphql
from api.core.logging_config import get_logger
from api.core.queries import MAP_PATTERN_CODES_QUERY, MAP_PATTERN_FRAGMENT
from api.core.redis import add_key
from api.services.station_index import (
    HU_BBOX,
    RAIL_STATION_MODES,
    IndexedStation,
    load_station_index,
)
from api.util.time import today

logger = get_logger(__name__)

# Hungary with a margin for the border sections and stations next to it
MAP_BBOX = (
    HU_BBOX[0] - 0.25,
    HU_BBOX[1] - 0.25,
    HU_BBOX[2] + 0.25,
    HU_BBOX[3] + 0.25,
)

# Rebuilt daily; survives missed runs
LAYER_TTL_S = 4 * 24 * 60 * 60
# Upper bound of one build, also how long a build holds the lock
BUILD_TIMEOUT_S = 300.0

# --- Network ---

# Passenger rail; rail replacement buses and coaches are left out
NETWORK_MODES = {"RAIL", "SUBURBAN_RAILWAY", "TRAMTRAIN"}
HEV_MODE = "SUBURBAN_RAILWAY"
# The HÉV's agency is "MÁV Személyszállítási Zrt. (HÉV)"
HEV_AGENCY_MARK = "HÉV"
# Patterns per upstream query
PATTERN_BATCH = 500
# Grid the lines are merged on, in degrees (~1.1 km north-south)
CELL_DEG = 0.01
# Longest step between points before they are assigned to cells
DENSIFY_DEG = CELL_DEG / 2
# Douglas-Peucker tolerance, in degrees (~30 m)
SIMPLIFY_DEG = 0.0003
COORD_DECIMALS = 5

type LatLon = tuple[float, float]
type Cell = tuple[int, int]
type Edge = tuple[Cell, Cell]


@dataclass(frozen=True, slots=True)
class PatternTrips:
    """A stopping pattern of the timetable and its trips on the day"""

    points: list[LatLon]
    trips: int
    hev: bool


def patterns_from_otp(patterns: Iterable[dict[str, Any] | None]) -> list[PatternTrips]:
    """Keep the passenger rail patterns that run on the day and have a geometry."""
    result: list[PatternTrips] = []
    for pattern in patterns:
        if not pattern:
            continue
        route = pattern.get("route") or {}
        mode = route.get("mode")
        if mode not in NETWORK_MODES:
            continue
        agency = (route.get("agency") or {}).get("name") or ""
        encoded = (pattern.get("patternGeometry") or {}).get("points")
        trips = len(pattern.get("tripsForDate") or [])
        if not encoded or not trips:
            continue
        points = [(float(lat), float(lon)) for lat, lon in polyline.decode(encoded)]
        if len(points) < 2:
            continue
        points = densify(points, DENSIFY_DEG)
        # Foreign S-Bahns share the mode; they are drawn as railways
        hev = mode == HEV_MODE and HEV_AGENCY_MARK in agency
        result.append(PatternTrips(points=points, trips=trips, hev=hev))
    return result


def densify(points: list[LatLon], step: float) -> list[LatLon]:
    """
    Add points so consecutive ones are at most `step` apart. Geometries drawn
    stop to stop would otherwise jump across grid cells and miss the edges
    the detailed geometries of the same track cross.
    """
    result = [points[0]]
    for (lat0, lon0), (lat1, lon1) in pairwise(points):
        parts = int(max(abs(lat1 - lat0), abs(lon1 - lon0)) / step)
        for k in range(1, parts + 1):
            t = k / (parts + 1)
            result.append((lat0 + (lat1 - lat0) * t, lon0 + (lon1 - lon0) * t))
        result.append((lat1, lon1))
    return result


def _cell(point: LatLon) -> Cell:
    return round(point[0] / CELL_DEG), round(point[1] / CELL_DEG)


def _edge(a: Cell, b: Cell) -> Edge:
    return (a, b) if a < b else (b, a)


def _inside(point: LatLon, bbox: tuple[float, float, float, float]) -> bool:
    min_lat, min_lon, max_lat, max_lon = bbox
    return min_lat <= point[0] <= max_lat and min_lon <= point[1] <= max_lon


def simplify(points: list[LatLon], tolerance: float) -> list[LatLon]:
    """Douglas-Peucker on plain degrees."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ay, ax = points[a]
        by, bx = points[b]
        dx, dy = bx - ax, by - ay
        length = (dx * dx + dy * dy) ** 0.5 or 1e-12
        max_d, index = 0.0, -1
        for i in range(a + 1, b):
            y, x = points[i]
            d = abs(dy * (x - ax) - dx * (y - ay)) / length
            if d > max_d:
                max_d, index = d, i
        if max_d > tolerance:
            keep[index] = True
            stack.append((a, index))
            stack.append((index, b))
    return [p for p, k in zip(points, keep, strict=True) if k]


def _line_feature(run: list[LatLon], n: int, hev: bool) -> dict[str, Any] | None:
    coordinates: list[list[float]] = []
    for lat, lon in simplify(run, SIMPLIFY_DEG):
        coord = [round(lon, COORD_DECIMALS), round(lat, COORD_DECIMALS)]
        if not coordinates or coordinates[-1] != coord:
            coordinates.append(coord)
    if len(coordinates) < 2:
        return None
    return {
        "type": "Feature",
        "properties": {"n": n, "hev": int(hev)},
        "geometry": {"type": "LineString", "coordinates": coordinates},
    }


def _undrawn_runs(
    pattern: PatternTrips,
    cells: list[Cell],
    counts: dict[tuple[bool, Edge], int],
    drawn: set[tuple[bool, Edge]],
    bbox: tuple[float, float, float, float],
) -> Iterator[tuple[list[LatLon], int]]:
    """
    Stretches of the pattern over edges no other line has drawn yet, split
    where the train count changes, with their count. Marks the edges drawn.
    """
    points = pattern.points
    run: list[LatLon] = []
    run_n = 0
    first_edge = True
    for j in range(1, len(points)):
        if cells[j] == cells[j - 1]:
            # Within a grid cell: follows whatever the line is doing
            if run:
                run.append(points[j])
            continue
        key = (pattern.hev, _edge(cells[j - 1], cells[j]))
        inside = _inside(points[j - 1], bbox) and _inside(points[j], bbox)
        if not inside or key in drawn:
            if run:
                yield run, run_n
            run = []
            first_edge = False
            continue
        drawn.add(key)
        n = counts[key]
        if run and n == run_n:
            run.append(points[j])
            continue
        if run:
            yield run, run_n
        # A line's first edge also takes the stretch before it, so the line
        # reaches its terminus
        run = points[: j + 1] if first_edge else [points[j - 1], points[j]]
        run_n = n
        first_edge = False
    if run:
        yield run, run_n


def build_network(
    patterns: list[PatternTrips],
    bbox: tuple[float, float, float, float] = MAP_BBOX,
) -> dict[str, Any]:
    """
    Merge the patterns on a grid so overlapping ones add up: every grid edge a
    pattern crosses counts its trips once. Each edge is then drawn once, by the
    busiest pattern crossing it, as part of a line of equal train counts.
    HÉV and the railways are counted separately.
    """
    counts: dict[tuple[bool, Edge], int] = defaultdict(int)
    cells_of: list[list[Cell]] = []
    for pattern in patterns:
        cells = [_cell(p) for p in pattern.points]
        cells_of.append(cells)
        edges = {
            _edge(a, b)
            for (a, b), (pa, pb) in zip(
                pairwise(cells), pairwise(pattern.points), strict=True
            )
            if a != b and _inside(pa, bbox) and _inside(pb, bbox)
        }
        for edge in edges:
            counts[(pattern.hev, edge)] += pattern.trips

    features: list[dict[str, Any]] = []
    drawn: set[tuple[bool, Edge]] = set()
    order = sorted(
        range(len(patterns)),
        key=lambda i: (-patterns[i].trips, -len(patterns[i].points)),
    )
    for i in order:
        for run, n in _undrawn_runs(patterns[i], cells_of[i], counts, drawn, bbox):
            feature = _line_feature(run, n, patterns[i].hev)
            if feature:
                features.append(feature)

    # Main lines last so they draw on top
    features.sort(key=lambda f: f["properties"]["n"])
    return {"type": "FeatureCollection", "features": features}


def _patterns_query(codes: list[str]) -> str:
    fields = "\n".join(
        f"    p{i}: pattern(id: {json.dumps(code)}) {{ ...MapPattern }}"
        for i, code in enumerate(codes)
    )
    return (
        f"query MapPatterns($date: String!) {{\n{fields}\n  }}\n" + MAP_PATTERN_FRAGMENT
    )


async def fetch_patterns(service_date: date) -> list[PatternTrips]:
    """Rail patterns calling at stops in the map's bbox, with their trips."""
    min_lat, min_lon, max_lat, max_lon = MAP_BBOX
    data = await query_graphql(
        MAP_PATTERN_CODES_QUERY,
        {"minLat": min_lat, "minLon": min_lon, "maxLat": max_lat, "maxLon": max_lon},
        timeout=120.0,
    )
    codes = sorted(
        {
            pattern["code"]
            for stop in data.get("stopsByBbox") or []
            if stop.get("vehicleMode") in RAIL_STATION_MODES
            for pattern in stop.get("patterns") or []
            # Realtime variants (`::rt#…`) of the timetable's patterns
            if pattern.get("code") and "rt#" not in pattern["code"]
        }
    )
    patterns: list[PatternTrips] = []
    date_str = service_date.strftime("%Y%m%d")
    for start in range(0, len(codes), PATTERN_BATCH):
        batch = codes[start : start + PATTERN_BATCH]
        result = await query_graphql(
            _patterns_query(batch), {"date": date_str}, timeout=120.0
        )
        patterns.extend(patterns_from_otp(result.values()))
    return patterns


# --- Stations ---

# Days of history averaged
STATION_DAYS = 14
# History looked at, so the query stays bounded as the table grows
STATION_LOOKBACK_DAYS = 90
# Days with fewer observations than this share of the best day looked at were
# only partly recorded (outages, deploys) and are skipped
FULL_DAY_SHARE = 0.5


def station_features(
    stations: list[IndexedStation],
    per_day: dict[str, float],
    bbox: tuple[float, float, float, float] = MAP_BBOX,
) -> dict[str, Any]:
    features: list[dict[str, Any]] = []
    for station in stations:
        if not _inside((station.lat, station.lon), bbox):
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "id": station.id,
                    "name": station.name,
                    "short": station.name.removeprefix("Budapest-"),
                    "perDay": per_day.get(station.id, 0.0),
                    # From the station index (replacement bus stops are not
                    # in it): rail, hev, tramtrain or childrens_railway
                    "type": station.type,
                    # For app builds from before `type`; drop once they are gone
                    "hev": int(station.type == "hev"),
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                        round(station.lon, COORD_DECIMALS),
                        round(station.lat, COORD_DECIMALS),
                    ],
                },
            }
        )
    features.sort(key=lambda f: (-f["properties"]["perDay"], f["properties"]["name"]))
    return {"type": "FeatureCollection", "features": features}


def full_days(day_totals: list[tuple[date, int]]) -> list[date]:
    """The latest STATION_DAYS days that were recorded in full."""
    if not day_totals:
        return []
    best = max(total for _, total in day_totals)
    full = sorted(day for day, total in day_totals if total >= best * FULL_DAY_SHARE)
    return full[-STATION_DAYS:]


async def trains_per_day(session: AsyncSession, today: date) -> dict[str, float]:
    """Average trains observed per day at each station (UIC code)."""
    day_rows = await session.execute(
        text(
            """
            SELECT service_date, sum(n) FROM delay_daily_agg
            WHERE service_date >= :since
            GROUP BY service_date
            """
        ),
        {"since": today - timedelta(days=STATION_LOOKBACK_DAYS)},
    )
    days = full_days([(row[0], int(row[1])) for row in day_rows])
    if not days:
        return {}
    rows = await session.execute(
        text(
            """
            SELECT station_id, sum(n) FROM delay_daily_agg
            WHERE service_date = ANY(:days)
            GROUP BY station_id
            """
        ),
        {"days": days},
    )
    return {row[0]: round(int(row[1]) / len(days), 1) for row in rows}


# --- Storage ---


def _dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def etag_of(body: str) -> str:
    return '"' + hashlib.sha256(body.encode()).hexdigest()[:32] + '"'


@dataclass(frozen=True, slots=True)
class StoredLayer:
    body: str
    etag: str


async def build_network_layer(redis: Redis, session: AsyncSession) -> str:
    start = time.time()
    patterns = await fetch_patterns(today())
    collection = await asyncio.to_thread(build_network, patterns)
    body = _dumps(collection)
    logger.info(
        f"Map network built: {len(patterns)} patterns, "
        f"{len(collection['features'])} lines, {len(body)} bytes "
        f"(Time: {(time.time() - start):.2f}s)"
    )
    return body


async def build_stations_layer(redis: Redis, session: AsyncSession) -> str:
    start = time.time()
    stations = await load_station_index(redis)
    per_day = await trains_per_day(session, today())
    collection = station_features(stations, per_day)
    body = _dumps(collection)
    logger.info(
        f"Map stations built: {len(collection['features'])} stations, "
        f"{len(body)} bytes (Time: {(time.time() - start):.2f}s)"
    )
    return body


type LayerBuilder = Callable[[Redis, AsyncSession], Awaitable[str]]

LAYERS: dict[str, LayerBuilder] = {
    "network": build_network_layer,
    "stations": build_stations_layer,
}


# Storage key per layer: a new key when a layer's properties change, so the
# stored copy is rebuilt on deploy instead of served until its daily rebuild
LAYER_KEYS = {"network": "map-network", "stations": "map-stations-v2"}


def layer_key(name: str) -> str:
    return add_key(LAYER_KEYS[name])


async def store_layer(redis: Redis, name: str, body: str) -> StoredLayer:
    layer = StoredLayer(body=body, etag=etag_of(body))
    async with redis.pipeline(transaction=True) as pipe:
        pipe.hset(layer_key(name), mapping={"body": layer.body, "etag": layer.etag})
        pipe.expire(layer_key(name), LAYER_TTL_S)
        await pipe.execute()
    return layer


async def build_layer(redis: Redis, session: AsyncSession, name: str) -> StoredLayer:
    """Build a layer and store it (the daily task)."""
    body = await asyncio.wait_for(LAYERS[name](redis, session), BUILD_TIMEOUT_S)
    return await store_layer(redis, name, body)


async def _stored(redis: Redis, name: str) -> StoredLayer | None:
    stored = await redis.hgetall(layer_key(name))  # type: ignore[misc]
    if not stored or "body" not in stored or "etag" not in stored:
        return None
    return StoredLayer(body=stored["body"], etag=stored["etag"])


# One build at a time per process; the Redis lock covers other processes
_build_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
# How often a caller waiting for another process's build checks for it
LOCK_POLL_S = 0.5


async def load_layer(redis: Redis, session: AsyncSession, name: str) -> StoredLayer:
    """The stored layer, built on a miss by one caller while the others wait."""
    stored = await _stored(redis, name)
    if stored:
        return stored
    async with _build_locks[name]:
        lock_key = add_key(f"{LAYER_KEYS[name]}-build-lock")
        token = secrets.token_hex(8)
        while True:
            stored = await _stored(redis, name)
            if stored:
                return stored
            # Expires by itself should the builder die
            if await redis.set(lock_key, token, nx=True, ex=int(BUILD_TIMEOUT_S) + 30):
                break
            await asyncio.sleep(LOCK_POLL_S)
        try:
            stored = await _stored(redis, name)
            return stored or await build_layer(redis, session, name)
        finally:
            if await redis.get(lock_key) == token:
                await redis.delete(lock_key)
