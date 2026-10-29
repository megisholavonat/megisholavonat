import math
import time
from typing import Any, Literal

import polyline  # type: ignore[import-untyped]
from shapely.geometry import LineString, Point

from api.util.trip import seconds_into_service_day

# The rules below are a port of packages/core/src/vehicle.ts (isStale,
# trainActivity, isFarFromRoute). Keep both in sync. The API sends `activity`
# with every train; clients combine it with the age of the position through
# core's trainDisplay, so the map and the train sheet agree. Both read
# the clock through the service-date resolution in api/util/trip.py, ported
# to packages/core/src/time.ts as `secondsIntoServiceDay`.

# Stale trains, mirroring STALE_GREY_AFTER_S / STALE_HIDE_AFTER_S in
# packages/core/src/constants.ts: grey after 5 minutes without an update,
# removed from the train list after 30 minutes.
STALE_GREY_AFTER_S = 300
STALE_HIDE_AFTER_S = 1800
# A train this far from its designated route is inactive
FAR_FROM_ROUTE_KM = 2
# "Near" a terminus, in meters
NEAR_STATION_M = 1000
# Long routes are sampled down to about this many points
MAX_ROUTE_POINTS = 1000
# Faster than this (m/s, about 7 km/h) near its terminus a train still runs
MOVING_MPS = 2.0

# What the train is doing, by its position and schedule. Only "running"
# trains show a live delay. Mirrors core's TrainActivity.
TrainActivity = Literal[
    "running", "beforeDeparture", "arrived", "offRoute", "cancelled"
]

# Earth radius used by turf.distance
_EARTH_RADIUS_M = 6_371_008.8


def should_remove(vehicle_position: dict[str, Any], now: float | None = None) -> bool:
    """
    Determines if a vehicle position is too stale to display (hidden after
    30 minutes without an update). Mirrors core's STALE_HIDE_AFTER_S.
    `now` defaults to the wall clock; replay passes the snapshot time.
    """
    if now is None:
        now = time.time()
    last_updated: int = vehicle_position.get("lastUpdated", 0)

    return now - last_updated > STALE_HIDE_AFTER_S


def _distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance in meters, like turf.distance."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlam = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    )
    return 2 * _EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def is_stale(vehicle_position: dict[str, Any], now: float | None = None) -> bool:
    """
    No position update for over 5 minutes. Mirrors core's `isStale`.
    `now` defaults to the wall clock; replay passes the snapshot time.
    """
    if now is None:
        now = time.time()
    last_updated = vehicle_position.get("lastUpdated") or 0
    return now - last_updated > STALE_GREY_AFTER_S


def is_far_from_route(vehicle_position: dict[str, Any]) -> bool:
    """
    More than 2 km from the trip geometry. Mirrors core's `isFarFromRoute`.
    turf's spherical nearest point is approximated by the nearest point in a
    local equirectangular projection, which agrees to metres at this scale.
    """
    lat = vehicle_position.get("lat")
    lon = vehicle_position.get("lon")
    points = ((vehicle_position.get("trip") or {}).get("tripGeometry") or {}).get(
        "points"
    )
    if not points or lat is None or lon is None:
        return False

    try:
        route = polyline.decode(points)
    except (ValueError, IndexError, TypeError):
        return False

    coords = [
        (lng, la)
        for la, lng in route
        if isinstance(la, int | float)
        and isinstance(lng, int | float)
        and not math.isnan(la)
        and not math.isnan(lng)
    ]
    if len(coords) < 2:
        return False

    if len(coords) > MAX_ROUTE_POINTS:
        step = math.ceil(len(coords) / MAX_ROUTE_POINTS)
        coords = [c for i, c in enumerate(coords) if i % step == 0]
        if len(coords) < 2:
            return False

    # Quick bounding box check (1 degree is roughly 111 km)
    buffer = FAR_FROM_ROUTE_KM / 111
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    if (
        lon < min(lons) - buffer
        or lon > max(lons) + buffer
        or lat < min(lats) - buffer
        or lat > max(lats) + buffer
    ):
        return True

    scale = math.cos(math.radians(lat))
    line = LineString([(c[0] * scale, c[1]) for c in coords])
    if line.length == 0:
        return False
    nearest = line.interpolate(line.project(Point(lon * scale, lat)))
    distance_m = _distance_m(lat, lon, nearest.y, nearest.x / scale)
    return distance_m > FAR_FROM_ROUTE_KM * 1000


def _remaining_cancelled(vehicle_position: dict[str, Any]) -> bool:
    """Every stop from the next one on is cancelled."""
    stops = (vehicle_position.get("trip") or {}).get("stoptimes") or []
    progress = vehicle_position.get("vehicleProgress") or {}
    next_index = progress.get("nextStopIndex") or 0
    ahead = stops[next_index:] or stops[-1:]
    return bool(ahead) and all(s.get("realtimeState") == "CANCELED" for s in ahead)


def activity(
    vehicle_position: dict[str, Any], now: float | None = None
) -> TrainActivity:
    """
    Whether the train is actually running its trip: not cancelled, not far off
    its route, not waiting at its origin before departure, and not standing at
    its destination. Mirrors core's `trainActivity`; `now` replaces the
    client's wall clock.
    """
    if now is None:
        now = time.time()
    trip = vehicle_position.get("trip") or {}
    stops = trip.get("stoptimes") or []
    if not stops:
        return "running"

    if _remaining_cancelled(vehicle_position):
        return "cancelled"

    if is_far_from_route(vehicle_position):
        return "offRoute"

    lat: float = vehicle_position.get("lat", 0.0)
    lon: float = vehicle_position.get("lon", 0.0)
    # The trip's `serviceDate` can be off by a day around midnight
    current_time = seconds_into_service_day(trip, now)

    first_stop = stops[0]
    first = first_stop.get("stop") or {}
    if (
        first.get("lat") is not None
        and first.get("lon") is not None
        and _distance_m(lat, lon, first["lat"], first["lon"]) <= NEAR_STATION_M
    ):
        departure = first_stop.get("realtimeDeparture")
        if departure is None:
            departure = first_stop.get("scheduledDeparture")
        if departure is not None and current_time < departure:
            return "beforeDeparture"  # At the departure station but not left yet

    # Near the destination and no longer moving. A train still pulling in at
    # speed is running: the last kilometre takes a minute or two.
    last = stops[-1].get("stop") or {}
    moving = (vehicle_position.get("speed") or 0) > MOVING_MPS
    if (
        not moving
        and last.get("lat") is not None
        and last.get("lon") is not None
        and _distance_m(lat, lon, last["lat"], last["lon"]) <= NEAR_STATION_M
    ):
        return "arrived"
    return "running"


def is_active(vehicle_position: dict[str, Any], now: float | None = None) -> bool:
    """Running its trip (see `activity`). Mirrors core's `isActive`."""
    return activity(vehicle_position, now) == "running"


def is_stale_or_inactive(
    vehicle_position: dict[str, Any], now: float | None = None
) -> bool:
    """The `isStale` flag of the train list: grey on the map."""
    return is_stale(vehicle_position, now) or not is_active(vehicle_position, now)
