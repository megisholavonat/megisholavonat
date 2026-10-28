import math
from datetime import datetime
from typing import Any

import numpy as np
from shapely.geometry import LineString, Point

from api.util.route import (
    RouteGeometry,
    best_aligned_projection,
    snapped_stops,
)
from api.util.trip import seconds_into_service_day

# The heading may only move the projection to a segment at most this much
# further from the GPS position than the nearest point of the route. Genuine
# ambiguities (out-and-back over the same track, loops, parallel tracks) are a
# few metres apart; a stationary vehicle's heading is often stale (a train
# waiting at its origin still faces the way it arrived), and the nearest
# "aligned" segment can then be hundreds of kilometres down the line.
MAX_HEADING_DETOUR_M = 50.0

# --- Helpers ---


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in meters."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlam = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    )
    return 2 * 6_371_000.0 * math.asin(min(1.0, math.sqrt(a)))


def calculate_bearing(p1: tuple[float, float], p2: tuple[float, float]) -> float:
    """
    Calculates the bearing between two points (in degrees).
    """
    lon1, lat1 = p1
    lon2, lat2 = p2

    d_lon = lon2 - lon1
    y = math.sin(math.radians(d_lon)) * math.cos(math.radians(lat2))
    x = math.cos(math.radians(lat1)) * math.sin(math.radians(lat2)) - math.sin(
        math.radians(lat1)
    ) * math.cos(math.radians(lat2)) * math.cos(math.radians(d_lon))

    bearing = math.degrees(math.atan2(y, x))
    return (bearing + 360) % 360


def project_with_heading(
    line: LineString,
    point: Point,
    heading: float | None,
    coords: np.ndarray | None = None,
) -> float:
    """
    Projects a point onto a line, respecting vehicle heading to handle
    loops/intersections.
    """
    default_proj = line.project(point)

    if heading is None:
        return default_proj

    # Check if default projection is valid (bearing aligns within 90 degrees)
    # We sample a tiny bit ahead to check direction
    delta = 1e-5  # Small delta in degrees
    p_curr = line.interpolate(default_proj)
    p_next = line.interpolate(default_proj + delta)

    if default_proj + delta > line.length:
        p_next = p_curr
        p_curr = line.interpolate(default_proj - delta)
        # Reverse vector direction for end of line check
        bearing_p1, bearing_p2 = (p_next.x, p_next.y), (p_curr.x, p_curr.y)
    else:
        bearing_p1, bearing_p2 = (p_curr.x, p_curr.y), (p_next.x, p_next.y)

    route_bearing = calculate_bearing(bearing_p1, bearing_p2)

    diff = abs(heading - route_bearing)
    if diff > 180:
        diff = 360 - diff

    # If alignment is good, accept it
    if diff <= 90:
        return default_proj

    # Otherwise, pick the closest segment that matches the heading, as long as
    # the GPS position is (nearly) as close to it as to the nearest point
    if coords is None:
        coords = np.asarray(line.coords, dtype=float)
    best = best_aligned_projection(coords, point.x, point.y, heading)
    if best is None:
        return default_proj
    nearest = line.interpolate(default_proj)
    aligned = line.interpolate(best)
    detour = haversine_m(point.y, point.x, aligned.y, aligned.x) - haversine_m(
        point.y, point.x, nearest.y, nearest.x
    )
    return best if detour <= MAX_HEADING_DETOUR_M else default_proj


def snap_stops(
    route_coords: list[tuple[float, float]], stops: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """
    Snaps stops to the route line and calculates distance along route.
    """
    if len(route_coords) < 2:
        return []

    line = LineString(route_coords)
    processed_stops = []

    for stop in stops:
        stop_point = Point(stop["coords"])
        distance_along_route = line.project(stop_point)

        processed_stops.append(
            {
                "id": stop["id"],
                "gtfsId": stop.get("gtfsId"),
                "index": stop.get("index"),
                "originalCoords": stop["coords"],
                "distanceAlongRoute": distance_along_route,
            }
        )

    processed_stops.sort(key=lambda x: x["distanceAlongRoute"])

    return processed_stops


def get_vehicle_progress(
    route_coords: list[tuple[float, float]],
    processed_stops: list[dict[str, Any]],
    vehicle_pos: tuple[float, float],
    heading: float | None = None,
    vehicle_distance: float | None = None,
) -> dict[str, Any]:
    """
    Determines the last and next stop based on vehicle position.
    vehicle_pos: [lon, lat]
    """
    empty = {
        "lastStop": "",
        "nextStop": "",
        "lastStopIndex": None,
        "nextStopIndex": None,
        "progress": 0,
    }
    if not processed_stops or len(route_coords) < 2:
        return empty

    if vehicle_distance is None:
        # Use heading-aware projection
        vehicle_distance = project_with_heading(
            LineString(route_coords), Point(vehicle_pos), heading
        )
    vehicle_distance_along_route = vehicle_distance

    last_stop = processed_stops[0]
    next_stop = None

    for stop in processed_stops:
        if stop["distanceAlongRoute"] <= vehicle_distance_along_route:
            last_stop = stop
        else:
            next_stop = stop
            break

    if not next_stop:
        final = processed_stops[-1]
        return {
            "lastStop": final["id"],
            "nextStop": final["id"],
            "lastStopIndex": final.get("index"),
            "nextStopIndex": final.get("index"),
            "progress": 1,
        }

    total_leg_distance = (
        next_stop["distanceAlongRoute"] - last_stop["distanceAlongRoute"]
    )
    traveled_leg_distance = (
        vehicle_distance_along_route - last_stop["distanceAlongRoute"]
    )

    progress = (
        1 if total_leg_distance == 0 else traveled_leg_distance / total_leg_distance
    )

    return {
        "lastStop": last_stop["id"],
        "nextStop": next_stop["id"],
        "lastStopIndex": last_stop.get("index"),
        "nextStopIndex": next_stop.get("index"),
        "progress": progress,
    }


# --- Main Function ---


def get_delay_and_position(
    calculate_date: datetime,
    service_date: str,
    stoptimes: list[dict[str, Any]],
    # [lat, lon] points from the polyline, or a (cached) RouteGeometry
    route_coords: list[tuple[float, float]] | RouteGeometry,
    lat: float,
    lon: float,
    heading: float | None = None,
) -> dict[str, Any]:
    # Current time on the stoptimes' clock (seconds into the service day)
    current_time = seconds_into_service_day(
        {"serviceDate": service_date, "stoptimes": stoptimes},
        calculate_date.timestamp(),
    )

    # GeoJSON [lon, lat] points without duplicates, and the shapely line
    route = (
        route_coords
        if isinstance(route_coords, RouteGeometry)
        else RouteGeometry.from_latlon(route_coords)
    )
    unique_geojson_route_coords = route.coords

    # Prepare stops for processing. `id` stays the stop name for API
    # compatibility; matching back to stoptimes uses the stoptimes index, which
    # is unambiguous even when a trip calls at a station twice.
    stops_key = tuple(
        (
            stop_data.get("name"),
            stop_data.get("gtfsId"),
            index,
            stop_data.get("lon"),
            stop_data.get("lat"),
        )
        for index, stop_data in (
            (i, st.get("stop", {})) for i, st in enumerate(stoptimes)
        )
    )

    # Process stops (snap to line); identical for every observation of a trip
    processed_stops = snapped_stops(route, stops_key)

    # Add stop time info back
    processed_stops_with_info = []
    for p_stop in processed_stops:
        new_p_stop = p_stop.copy()
        new_p_stop["stopTimeInfo"] = stoptimes[p_stop["index"]]
        processed_stops_with_info.append(new_p_stop)

    # Train position along route (heading-aware projection), computed once
    train_position = 0.0
    off_route_m: float | None = None
    if route.line is not None:
        line = route.line
        vehicle_point = Point(lon, lat)
        train_position = project_with_heading(
            line, vehicle_point, heading, route.coords_array
        )
        nearest = line.interpolate(line.project(vehicle_point))
        off_route_m = haversine_m(lat, lon, nearest.y, nearest.x)

    # Get vehicle progress
    vehicle_progress = get_vehicle_progress(
        unique_geojson_route_coords,
        list(processed_stops),
        (lon, lat),
        heading,
        vehicle_distance=train_position if route.line is not None else None,
    )

    total_route_distance = 0
    if processed_stops:
        total_route_distance = max(s["distanceAlongRoute"] for s in processed_stops)

    # Calculate Delay
    delay = 0

    last_index = vehicle_progress["lastStopIndex"]
    next_index = vehicle_progress["nextStopIndex"]
    previous_stop_time = stoptimes[last_index] if last_index is not None else None
    next_stop_time = stoptimes[next_index] if next_index is not None else None

    if previous_stop_time and next_stop_time:
        prev_dep = previous_stop_time.get("scheduledDeparture", 0)
        next_arr = next_stop_time.get("scheduledArrival", 0)

        time_between_stops = next_arr - prev_dep

        interpolated_time = prev_dep + (
            time_between_stops * vehicle_progress["progress"]
        )

        delay = current_time - interpolated_time

    return {
        "delay": delay,
        "trainPosition": train_position,
        "totalRouteDistance": total_route_distance,
        "processedStops": processed_stops_with_info,
        "vehicleProgress": vehicle_progress,
        "offRouteMeters": off_route_m,
    }
