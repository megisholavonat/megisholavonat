"""Search index of rail stations.

OTP groups the per-platform rail stops (`1:<UIC>_<platform>`) under parent
stations (`1:<UIC>`). The parent stations of the rail feed are fetched once a
day, stored in Redis and searched in-process.
"""

import json
import time
from dataclasses import dataclass
from typing import Any

from redis.asyncio import Redis

from api.core.graphql import query_graphql
from api.core.logging_config import get_logger
from api.core.queries import STATIONS_QUERY
from api.core.redis import add_key
from api.schemas.stations import Station
from api.util.search import normalize_search_text

logger = get_logger(__name__)

# Feed holding every railway (MÁV, GYSEV, HÉV and foreign operators)
RAIL_FEED = "1"
# Stations without a mode are rail stations with no current service
RAIL_STATION_MODES = {"RAIL", "SUBURBAN_RAILWAY", "TRAMTRAIN", None}
# Rough bounding box of Hungary, used to rank domestic stations first
HU_BBOX = (45.7, 16.1, 48.6, 22.95)

INDEX_TTL = 3 * 24 * 60 * 60  # rebuilt daily; survives a missed run


def index_key() -> str:
    return add_key("stations-index")


def index_version_key() -> str:
    return add_key("stations-index-version")


@dataclass(frozen=True, slots=True)
class IndexedStation:
    id: str
    name: str
    lat: float
    lon: float
    normalized: str
    words: tuple[str, ...]
    in_hungary: bool

    def to_schema(self) -> Station:
        return Station(id=self.id, name=self.name, lat=self.lat, lon=self.lon)


def _indexed(id_: str, name: str, lat: float, lon: float) -> IndexedStation:
    normalized = normalize_search_text(name)
    min_lat, min_lon, max_lat, max_lon = HU_BBOX
    return IndexedStation(
        id=id_,
        name=name,
        lat=lat,
        lon=lon,
        normalized=normalized,
        words=tuple(normalized.split()),
        in_hungary=min_lat <= lat <= max_lat and min_lon <= lon <= max_lon,
    )


def rail_stations_from_otp(stations: list[dict[str, Any]]) -> list[list[Any]]:
    """
    Keep the rail parent stations and return them as compact
    [id, name, lat, lon] rows, where id is the UIC station code.
    """
    rows: list[list[Any]] = []
    for station in stations:
        feed, _, local_id = (station.get("gtfsId") or "").partition(":")
        if feed != RAIL_FEED or not local_id.isdigit():
            # `1:v.<UIC>` entries are rail replacement bus stops
            continue
        if station.get("vehicleMode") not in RAIL_STATION_MODES:
            continue
        if station.get("lat") is None or station.get("lon") is None:
            continue
        rows.append([local_id, station["name"], station["lat"], station["lon"]])
    rows.sort(key=lambda r: r[0])
    return rows


async def build_station_index(redis: Redis) -> list[IndexedStation]:
    """Fetch all stations from upstream and store the rail ones in Redis."""
    start = time.time()
    data = await query_graphql(STATIONS_QUERY, timeout=60.0)
    rows = rail_stations_from_otp(data.get("stations") or [])
    version = str(time.time())

    async with redis.pipeline(transaction=True) as pipe:
        pipe.set(index_key(), json.dumps(rows, ensure_ascii=False), ex=INDEX_TTL)
        pipe.set(index_version_key(), version, ex=INDEX_TTL)
        await pipe.execute()

    logger.info(
        f"Station index built: {len(rows)} rail stations "
        f"(Time: {(time.time() - start):.2f}s)"
    )
    stations = [_indexed(*row) for row in rows]
    _memo.update(version=version, stations=stations)
    return stations


# Parsed index of this process, tagged with the Redis version it came from
_memo: dict[str, Any] = {"version": None, "stations": []}


def clear_memo() -> None:
    _memo.update(version=None, stations=[])


async def load_station_index(redis: Redis) -> list[IndexedStation]:
    """Return the index, building it on first use."""
    version = await redis.get(index_version_key())
    if version is not None and version == _memo["version"]:
        stations: list[IndexedStation] = _memo["stations"]
        return stations

    raw = await redis.get(index_key()) if version is not None else None
    if raw is None:
        return await build_station_index(redis)

    stations = [_indexed(*row) for row in json.loads(raw)]
    _memo.update(version=version, stations=stations)
    return stations


def _match_rank(station: IndexedStation, query: str) -> int | None:
    """Lower is better; None means no match."""
    if station.normalized == query:
        return 0
    if station.normalized.startswith(query):
        return 1
    if any(word.startswith(query) for word in station.words):
        return 2
    if query in station.normalized:
        return 3
    return None


def search_stations(
    stations: list[IndexedStation], query: str, limit: int
) -> list[Station]:
    """
    Accent-insensitive search. Exact matches come first, then prefix matches,
    then word-prefix matches ("keleti" -> "Budapest-Keleti"), then substrings.
    Ties prefer domestic stations and shorter names.
    """
    normalized_query = normalize_search_text(query)
    if not normalized_query:
        return []

    ranked: list[tuple[int, bool, int, str, IndexedStation]] = []
    for station in stations:
        rank = _match_rank(station, normalized_query)
        if rank is not None:
            ranked.append(
                (
                    rank,
                    not station.in_hungary,
                    len(station.normalized),
                    station.normalized,
                    station,
                )
            )

    ranked.sort(key=lambda r: r[:4])
    return [r[4].to_schema() for r in ranked[:limit]]
