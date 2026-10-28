"""Departure and arrival boards of rail stations."""

import time
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from redis.asyncio import Redis

from api.core.graphql import query_graphql
from api.core.queries import STATION_BOARD_QUERY
from api.core.redis import add_key
from api.schemas.stations import BoardEntry, BoardKind, Station, StationBoard
from api.services.live_trips import load_live_trip_index, match_live_trip
from api.services.station_index import RAIL_FEED

BOARD_TTL = 30  # seconds
# Look ahead this far first, and widen to a day for quiet stations
SHORT_RANGE = 4 * 60 * 60
LONG_RANGE = 24 * 60 * 60

TIMEZONE = ZoneInfo("Europe/Budapest")


class StationNotFoundError(Exception):
    pass


def board_cache_key(station_id: str, kind: BoardKind, limit: int) -> str:
    return add_key(f"station-board:{station_id}:{kind}:{limit}")


def service_date(service_day: int) -> str:
    # serviceDay is local noon minus 12 hours, so noon is always on the date
    noon = datetime.fromtimestamp(service_day, TIMEZONE) + timedelta(hours=12)
    return noon.date().isoformat()


def _is_listed(stoptime: dict[str, Any], kind: BoardKind) -> bool:
    if kind == "departures":
        return stoptime.get("pickupType") != "NONE"
    return stoptime.get("dropoffType") != "NONE"


def _board_entry(
    stoptime: dict[str, Any],
    kind: BoardKind,
    live_index: dict[str, Any],
) -> BoardEntry:
    trip = stoptime["trip"]
    route = trip.get("route") or {}
    origin = trip.get("departureStoptime") or {}
    service_day = stoptime["serviceDay"]
    date = service_date(service_day)

    if kind == "departures":
        scheduled = service_day + stoptime["scheduledDeparture"]
        expected = service_day + stoptime["realtimeDeparture"]
        headsign = stoptime.get("headsign") or trip.get("tripHeadsign")
    else:
        scheduled = service_day + stoptime["scheduledArrival"]
        expected = service_day + stoptime["realtimeArrival"]
        headsign = (origin.get("stop") or {}).get("name")

    delay = round((expected - scheduled) / 60)
    delay_source = "otp"
    realtime = bool(stoptime.get("realtime"))
    vehicle_id = None

    live = match_live_trip(
        live_index,
        trip_id=trip["gtfsId"],
        service_date=date,
        trip_short_name=trip.get("tripShortName") or "",
        origin_departure=origin.get("scheduledDeparture"),
    )
    if live is not None:
        vehicle_id = live.vehicleId
        delay = live.delay
        # Trains do not leave early; a negative GPS delay before departure
        # only means the train is waiting.
        if kind == "departures":
            delay = max(delay, 0)
        expected = scheduled + delay * 60
        delay_source = "gps"
        realtime = True

    return BoardEntry(
        tripId=trip["gtfsId"],
        tripShortName=trip.get("tripShortName") or "",
        routeShortName=route.get("shortName") or "",
        routeTextColor=route.get("textColor"),
        headsign=headsign,
        serviceDate=date,
        scheduledTime=scheduled,
        expectedTime=expected,
        delayMinutes=delay,
        delaySource=delay_source,
        platform=(stoptime.get("stop") or {}).get("platformCode"),
        realtime=realtime,
        canceled=stoptime.get("realtimeState") == "CANCELED",
        vehicleId=vehicle_id,
    )


async def _fetch_station(
    station_id: str, kind: BoardKind, limit: int, time_range: int
) -> dict[str, Any]:
    data = await query_graphql(
        STATION_BOARD_QUERY,
        {
            "id": f"{RAIL_FEED}:{station_id}",
            "n": limit,
            "range": time_range,
            # Arrival boards need trains ending here, which take no pickups
            "omitNonPickups": kind == "departures",
        },
    )
    station: dict[str, Any] | None = data.get("station")
    if station is None:
        raise StationNotFoundError(station_id)
    return station


async def fetch_board(
    redis: Redis, station_id: str, kind: BoardKind, limit: int
) -> StationBoard:
    station = await _fetch_station(station_id, kind, limit, SHORT_RANGE)
    stoptimes = [
        st
        for st in station.get("stoptimesWithoutPatterns") or []
        if _is_listed(st, kind)
    ]
    if len(stoptimes) < limit:
        station = await _fetch_station(station_id, kind, limit, LONG_RANGE)
        stoptimes = [
            st
            for st in station.get("stoptimesWithoutPatterns") or []
            if _is_listed(st, kind)
        ]

    live_index = await load_live_trip_index(redis)
    entries = [_board_entry(st, kind, live_index) for st in stoptimes]
    entries.sort(key=lambda e: (e.expectedTime, e.scheduledTime, e.tripId))

    return StationBoard(
        station=Station(
            id=station_id,
            name=station["name"],
            lat=station["lat"],
            lon=station["lon"],
        ),
        kind=kind,
        generatedAt=int(time.time()),
        entries=entries[:limit],
    )


async def get_board(
    redis: Redis, station_id: str, kind: BoardKind, limit: int
) -> StationBoard:
    """Board of a station by UIC code, cached for BOARD_TTL seconds."""
    if not station_id.isdigit():
        raise StationNotFoundError(station_id)

    cache_key = board_cache_key(station_id, kind, limit)
    cached = await redis.get(cache_key)
    if cached is not None:
        return StationBoard.model_validate_json(cached)

    board = await fetch_board(redis, station_id, kind, limit)
    await redis.set(cache_key, board.model_dump_json(), ex=BOARD_TTL)
    return board
