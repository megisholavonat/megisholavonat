"""Departure and arrival boards of rail stations."""

import time
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

from redis.asyncio import Redis

from api.core.cache import cached_model
from api.core.graphql import query_graphql
from api.core.queries import STATION_BOARD_QUERY
from api.schemas.alerts import DelayReason
from api.schemas.stations import BoardEntry, BoardKind, Station, StationBoard
from api.services.disruptions import (
    TrainDisruptions,
    TripStops,
    applies_at,
    get_train_disruptions,
    train_disruption,
    worst_train_disruption,
)
from api.services.live_trips import (
    apply_live_delay,
    load_live_trip_index,
    match_live_trip,
)
from api.services.station_index import RAIL_FEED
from api.util.stop import station_id_from_gtfs_id
from api.util.time import BUDAPEST_TZ
from api.util.trip import train_number

BOARD_TTL = 30  # seconds
# Look ahead this far first, and widen to a day for quiet stations
SHORT_RANGE = 4 * 60 * 60
LONG_RANGE = 24 * 60 * 60


class StationNotFoundError(Exception):
    pass


def board_cache_key(station_id: str, kind: BoardKind, limit: int) -> str:
    return f"station-board:{station_id}:{kind}:{limit}"


def service_date(service_day: int) -> str:
    # serviceDay is local noon minus 12 hours, so noon is always on the date
    noon = datetime.fromtimestamp(service_day, BUDAPEST_TZ) + timedelta(hours=12)
    return noon.date().isoformat()


def _is_listed(stoptime: dict[str, Any], kind: BoardKind) -> bool:
    if kind == "departures":
        return stoptime.get("pickupType") != "NONE"
    return stoptime.get("dropoffType") != "NONE"


def trip_stops(
    trip: dict[str, Any], station_id: str | None, kind: BoardKind
) -> TripStops | None:
    """The trip's stops and the board's station among them, if listed."""
    stops = trip.get("stops") or []
    # Stops are platforms of a station: "1:<UIC>_<platform>"
    uics = [station_id_from_gtfs_id(s.get("gtfsId") or "") for s in stops]
    if station_id is None or station_id not in uics:
        return None
    return TripStops(
        names=[s.get("name") or "" for s in stops],
        here=uics.index(station_id),
        departing=kind == "departures",
    )


def _board_entry(
    stoptime: dict[str, Any],
    kind: BoardKind,
    live_index: dict[str, Any],
    disruptions: TrainDisruptions | None = None,
    station_id: str | None = None,
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

    live = match_live_trip(
        live_index,
        trip_id=trip["gtfsId"],
        service_date=date,
        trip_short_name=trip.get("tripShortName") or "",
        origin_departure=origin.get("scheduledDeparture"),
    )
    # Off its route, arrived or cancelled, the train shows no live delay on
    # the map (QA n-C: 604 off route read "+5" on the Szolnok board while the
    # map showed none); the row is then like one without a live train
    delay = apply_live_delay(
        live,
        scheduled,
        expected,
        realtime=bool(stoptime.get("realtime")),
        departing=kind == "departures",
    )

    alerts = trip.get("alerts") or []
    stops = trip_stops(trip, station_id, kind)
    # The train's own notices in effect at its time here, then line
    # disruptions naming it; a notice about part of its run only counts on
    # that part
    in_effect = [
        a.get("alertDescriptionText") or ""
        for a in alerts
        if (a.get("effectiveStartDate") or 0) <= scheduled
        and (not a.get("effectiveEndDate") or scheduled <= a["effectiveEndDate"])
    ]
    own = [train_disruption(t) for t in in_effect if applies_at(t, stops)]
    named = (
        disruptions.of(
            trip["gtfsId"],
            train_number(trip.get("tripShortName") or ""),
            scheduled,
            stops,
        )
        if disruptions
        else None
    )

    return BoardEntry(
        tripId=trip["gtfsId"],
        tripShortName=trip.get("tripShortName") or "",
        routeShortName=route.get("shortName") or "",
        routeTextColor=route.get("textColor"),
        headsign=headsign,
        serviceDate=date,
        scheduledTime=scheduled,
        expectedTime=delay.expected,
        delayMinutes=delay.minutes,
        delaySource=delay.source,
        platform=(stoptime.get("stop") or {}).get("platformCode"),
        realtime=delay.realtime,
        canceled=stoptime.get("realtimeState") == "CANCELED",
        vehicleId=live.vehicleId if live is not None else None,
        reason=DelayReason.from_texts(*(a.get("alertDescriptionText") for a in alerts)),
        disruption=worst_train_disruption([*own, named]),
    )


def keep_best[T, K, R: tuple[Any, ...]](
    items: list[T], key: Callable[[T], K], rank: Callable[[T], R]
) -> list[T]:
    """One item per key, the highest ranked, in order of first appearance."""
    best: dict[K, T] = {}
    for item in items:
        k = key(item)
        existing = best.get(k)
        if existing is None or rank(item) > rank(existing):
            best[k] = item
    return list(best.values())


def merge_duplicate_trips(entries: list[BoardEntry]) -> list[BoardEntry]:
    """
    OTP sometimes lists one physical train as two trips (e.g. "201 ... InterCity"
    and "201 ... gyorsvonat"). Keep one row per train number and scheduled time,
    preferring the one matched to a live vehicle (with a live delay, then
    without), then a running one, then realtime data.
    """
    return keep_best(
        entries,
        key=lambda e: (e.serviceDate, train_number(e.tripShortName), e.scheduledTime),
        rank=lambda e: (
            e.delaySource == "gps",
            e.vehicleId is not None,
            not e.canceled,
            e.realtime,
        ),
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
    disruptions = await get_train_disruptions(redis)
    entries = merge_duplicate_trips(
        [
            _board_entry(st, kind, live_index, disruptions, station_id)
            for st in stoptimes
        ]
    )
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

    return await cached_model(
        redis,
        board_cache_key(station_id, kind, limit),
        StationBoard,
        BOARD_TTL,
        lambda: fetch_board(redis, station_id, kind, limit),
    )
