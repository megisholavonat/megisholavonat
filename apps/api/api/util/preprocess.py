import math
from datetime import datetime
from typing import Any

from shapely.geometry import LineString, Point

from api.util.time import get_seconds_since_day

# --- Helpers ---


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
    line: LineString, point: Point, heading: float | None
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

    # Otherwise, search for a better segment
    # Iterate through segments to find one that matches heading and is close
    coords = list(line.coords)
    best_dist = default_proj
    min_dist = float("inf")
    found_better = False

    current_len = 0.0

    for i in range(len(coords) - 1):
        p1 = coords[i]
        p2 = coords[i + 1]

        seg_vec = (p2[0] - p1[0], p2[1] - p1[1])
        seg_len = math.sqrt(seg_vec[0] ** 2 + seg_vec[1] ** 2)

        if seg_len == 0:
            continue

        # Calculate segment bearing
        seg_bearing = calculate_bearing((p1[0], p1[1]), (p2[0], p2[1]))

        # Check alignment
        h_diff = abs(heading - seg_bearing)
        if h_diff > 180:
            h_diff = 360 - h_diff

        if h_diff <= 90:
            # Valid segment, check distance
            seg_line = LineString([p1, p2])
            dist = seg_line.distance(point)

            if dist < min_dist:
                min_dist = dist
                dist_on_seg = seg_line.project(point)
                best_dist = current_len + dist_on_seg
                found_better = True

        current_len += seg_len

    return best_dist if found_better else default_proj


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
) -> dict[str, Any]:
    """
    Determines the last and next stop based on vehicle position.
    vehicle_pos: [lon, lat]
    """
    # Handle empty stops array
    if not processed_stops:
        return {"lastStop": "", "nextStop": "", "progress": 0}

    if len(route_coords) < 2:
        return {"lastStop": "", "nextStop": "", "progress": 0}

    line = LineString(route_coords)
    vehicle_point = Point(vehicle_pos)

    # Use heading-aware projection
    vehicle_distance_along_route = project_with_heading(line, vehicle_point, heading)

    last_stop = processed_stops[0]
    next_stop = None

    for stop in processed_stops:
        if stop["distanceAlongRoute"] <= vehicle_distance_along_route:
            last_stop = stop
        else:
            next_stop = stop
            break

    if not next_stop:
        last_stop_id = processed_stops[-1]["id"]
        return {"lastStop": last_stop_id, "nextStop": last_stop_id, "progress": 1}

    total_leg_distance = (
        next_stop["distanceAlongRoute"] - last_stop["distanceAlongRoute"]
    )
    traveled_leg_distance = (
        vehicle_distance_along_route - last_stop["distanceAlongRoute"]
    )

    if total_leg_distance == 0:
        return {"lastStop": last_stop["id"], "nextStop": next_stop["id"], "progress": 1}

    progress = traveled_leg_distance / total_leg_distance

    return {
        "lastStop": last_stop["id"],
        "nextStop": next_stop["id"],
        "progress": progress,
    }


# --- Main Function ---


def get_delay_and_position(
    calculate_date: datetime,
    service_date: str,
    stoptimes: list[dict[str, Any]],
    route_coords: list[tuple[float, float]],  # [lat, lon] from polyline
    lat: float,
    lon: float,
    heading: float | None = None,
) -> dict[str, Any]:
    # Calculate current time in seconds since midnight
    current_time = get_seconds_since_day(service_date, calculate_date)

    # Swap coords of routeCoords for GeoJSON [lon, lat]
    # route_coords input is [lat, lon], we need [lon, lat]
    geojson_route_coords = [[coord[1], coord[0]] for coord in route_coords]

    # Remove duplicates
    unique_geojson_route_coords: list[tuple[float, float]] = []
    seen = set()
    for coord in geojson_route_coords:
        t_coord: tuple[float, float] = (coord[0], coord[1])
        if t_coord not in seen:
            unique_geojson_route_coords.append(t_coord)
            seen.add(t_coord)

    # Prepare stops for processing
    stops = []
    for stop_time in stoptimes:
        stop_data = stop_time.get("stop", {})
        stops.append(
            {
                "id": stop_data.get("name"),
                "coords": [stop_data.get("lon"), stop_data.get("lat")],
            }
        )

    # Process stops (snap to line)
    processed_stops = snap_stops(unique_geojson_route_coords, stops)

    # Add stop time info back
    processed_stops_with_info = []
    for p_stop in processed_stops:
        original_stop_time = next(
            (st for st in stoptimes if st.get("stop", {}).get("name") == p_stop["id"]),
            None,
        )
        new_p_stop = p_stop.copy()
        new_p_stop["stopTimeInfo"] = original_stop_time
        processed_stops_with_info.append(new_p_stop)

    # Get vehicle progress
    vehicle_progress = get_vehicle_progress(
        unique_geojson_route_coords, processed_stops, (lon, lat), heading
    )

    # Calculate train position along route (re-using the robust projection)
    train_position = 0.0
    if len(unique_geojson_route_coords) >= 2:
        line = LineString(unique_geojson_route_coords)
        vehicle_point = Point(lon, lat)
        train_position = project_with_heading(line, vehicle_point, heading)

    total_route_distance = 0
    if processed_stops:
        total_route_distance = max(s["distanceAlongRoute"] for s in processed_stops)

    # Calculate Delay
    delay = 0

    previous_stop_time = next(
        (
            st
            for st in stoptimes
            if st.get("stop", {}).get("name") == vehicle_progress["lastStop"]
        ),
        None,
    )
    next_stop_time = next(
        (
            st
            for st in stoptimes
            if st.get("stop", {}).get("name") == vehicle_progress["nextStop"]
        ),
        None,
    )

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
    }
