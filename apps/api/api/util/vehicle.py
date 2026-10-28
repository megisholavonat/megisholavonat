import math
import time
from typing import Any

import polyline  # type: ignore[import-untyped]
from shapely.geometry import LineString, Point

from api.util.trip import seconds_into_service_day

REMOVAL_THRESHOLD_MINUTES = 120

# The rules below are a port of packages/core/src/vehicle.ts (isStale,
# isActive, isFarFromRoute). Keep both in sync: the map colours trains by the
# server-computed flag, the train panel by the client-side functions. Both read
# the clock through the service-date resolution in api/util/trip.py, ported
# to packages/core/src/time.ts as `secondsIntoServiceDay`.

# Show as stale after 30 minutes without an update
STALENESS_THRESHOLD_MINUTES = 30
# A train this far from its designated route is inactive
FAR_FROM_ROUTE_KM = 2
# "Near" a terminus, in meters
NEAR_STATION_M = 1000
# Long routes are sampled down to about this many points
MAX_ROUTE_POINTS = 1000

# Earth radius used by turf.distance
_EARTH_RADIUS_M = 6_371_008.8


def should_remove(vehicle_position: dict[str, Any], now: float | None = None) -> bool:
    """
    Determines if a vehicle position is too stale to display.
    `now` defaults to the wall clock; replay passes the snapshot time.
    """
    if now is None:
        now = time.time()
    last_updated: int = vehicle_position.get("lastUpdated", 0)

    minutes_since_update = (now - last_updated) / 60

    return minutes_since_update > REMOVAL_THRESHOLD_MINUTES


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
    No position update for over 30 minutes. Mirrors core's `isStale`.
    `now` defaults to the wall clock; replay passes the snapshot time.
    """
    if now is None:
        now = time.time()
    last_updated = vehicle_position.get("lastUpdated") or 0
    return (now - last_updated) / 60 > STALENESS_THRESHOLD_MINUTES


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


def is_active(vehicle_position: dict[str, Any], now: float | None = None) -> bool:
    """
    Whether the train is actually running its trip: not far off its route, not
    waiting at its origin before departure, and not at its destination.
    Mirrors core's `isActive`; `now` replaces the client's wall clock.
    """
    if now is None:
        now = time.time()
    trip = vehicle_position.get("trip") or {}
    stops = trip.get("stoptimes") or []
    if not stops:
        return True

    if is_far_from_route(vehicle_position):
        return False

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
            return False  # At the departure station but not left yet

    last = stops[-1].get("stop") or {}
    return not (
        last.get("lat") is not None
        and last.get("lon") is not None
        and _distance_m(lat, lon, last["lat"], last["lon"]) <= NEAR_STATION_M
    )  # Near or at the destination


def is_stale_or_inactive(
    vehicle_position: dict[str, Any], now: float | None = None
) -> bool:
    """The `isStale` flag of the train list: grey on the map."""
    return is_stale(vehicle_position, now) or not is_active(vehicle_position, now)
