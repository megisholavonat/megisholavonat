import bisect
import itertools
import math
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import numpy as np
from shapely.geometry import LineString, Point

from api.util.route import (
    Candidate,
    RouteGeometry,
    best_aligned_projection,
    projection_candidates,
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

# A vehicle this close to a stop (along the route) and not moving is standing
# at it. Long platforms and GPS noise put a standing train's reported position
# several hundred metres from the stop's point (~410 m for an InterCity at
# Budapest-Keleti). At its first stop, the 1 km of api.util.vehicle's
# NEAR_STATION_M, as `activity` uses for "beforeDeparture".
AT_STOP_M = 600.0
AT_ORIGIN_M = 1000.0
# Faster than this (m/s, about 7 km/h) a train is not standing at a stop.
# Same as api.util.vehicle.MOVING_MPS.
STANDING_MAX_MPS = 2.0
# Standing this far short of its next stop, a train is more likely held at a
# signal than berthed at a long platform, so it is late against the arrival.
# On replays of 2026-08-17..21, 97% of trains standing short of the stop's
# point after their arrival time were already berthed (median 33 m short), and
# measuring them all against the arrival overstated those by ~2.5 min. 400 m
# made up most of the held trains' minutes for the fewest berthed ones.
HELD_SHORT_M = 400.0

# Matching a position to the route. A route that comes back near itself (the
# InterCity circle that leaves Budapest-Nyugati and ends at Budapest-Keleti a
# few km away, trains reversing at a terminus, out-and-backs) passes some
# places more than once, and the nearest point of the line can be the wrong
# pass: QA NB-1, 650 TOKAJ just out of Nyugati matched to the last km of its
# route, "390 min early". Every pass within MATCH_SLACK_M of the nearest one
# is a candidate, and the one closest to the expected progress wins.
MATCH_SLACK_M = 500.0
# A pass that would make the train this early is implausible; then passes up
# to FAR_MATCH_M from the GPS position compete as well. The trip geometry is
# not always the track the train takes: 650 TOKAJ left Nyugati on a line
# 3.2 km from its geometry's first km, and 2 m from its last.
IMPLAUSIBLY_EARLY_S = 10 * 60
FAR_MATCH_M = 5000.0
# Stops are snapped the same way, keeping them in timetable order
STOP_SLACK_M = 1000.0
OUT_OF_ORDER_M = 50_000.0
# Along-route tolerance (line units, ~50 m) for two stops at the same place
ORDER_SLACK = 0.0005
# Candidate costs, in seconds of implied delay. Being early is less likely
# than being late (trains do not leave stops early), so it weighs more.
EARLY_WEIGHT = 3.0
# Each metre further from the GPS position than the nearest pass
METRE_COST_S = 1.0
# Facing against the route there while moving (a stopped train's heading is
# often stale: it still faces the way it arrived)
AGAINST_HEADING_S = 1800.0
# Outside the reach of the trip's previous position. It is large, but less
# than being hours early, so one wrong match cannot lock a train in place.
OFF_PREVIOUS_S = 7200.0
# The previous position counts if at most this old (seconds); the train may
# have gone back this far (GPS noise, a standing train) or forward this fast
PREVIOUS_MAX_AGE_S = 1800.0
PREVIOUS_BACK_M = 1000.0
PREVIOUS_MIN_REACH_M = 3000.0
PREVIOUS_MAX_MPS = 70.0

# A train still within this far past a stop before its scheduled departure,
# and slower than LEAVING_MPS, is standing there. Long trains are shunted,
# split or joined during long stops, and big stations' points are hundreds of
# metres from their platform ends: QA NM-1, 406 CORONA stood 1.1 km past
# Debrecen's point during its 24 min stop and read "17 min early".
BEFORE_DEPARTURE_M = 1500.0
# About 32 km/h: faster, near a stop before its departure time, it is leaving.
# On replays of six days (2026-08-18..09-03), of trains up to 1.5 km past a
# stop at least 2 min before its departure, 98% of those at 4-9 m/s were
# still there at the departure time (99% standing, 79% at 9-14 m/s, none at
# 14+ m/s). QA saw 406 at 8 m/s within Debrecen 16 min before it left.
LEAVING_MPS = 9.0

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


def _monotonic_stop_alongs(
    coords: np.ndarray, stops: list[dict[str, Any]]
) -> list[float]:
    """
    Distance along the route of each stop, in timetable order. A route that
    passes a place twice (a loop's two ends in Budapest, an out-and-back) has
    several candidates for a stop there; the stops take the candidates that
    keep them in timetable order along the route with the least total
    distance (a shortest path over the candidates). On a route that passes
    every stop once this is the nearest point, as `line.project`.
    """
    options = [
        projection_candidates(coords, s["coords"][0], s["coords"][1], STOP_SLACK_M)
        or [Candidate(along=0.0, metres=0.0, bearing=0.0)]
        for s in stops
    ]
    if not options:
        return []
    # cost[k]: least total metres with the current stop at its option k
    cost = [c.metres for c in options[0]]
    back: list[list[int]] = []
    for prev, cur in itertools.pairwise(options):
        step_cost: list[float] = []
        step_back: list[int] = []
        for c in cur:
            best_k, best = 0, math.inf
            for k, p in enumerate(prev):
                # Out of order costs as much as a stop far off the route
                order = 0.0 if c.along >= p.along - ORDER_SLACK else OUT_OF_ORDER_M
                total = cost[k] + order
                if total < best:
                    best_k, best = k, total
            step_cost.append(best + c.metres)
            step_back.append(best_k)
        cost = step_cost
        back.append(step_back)
    k = min(range(len(cost)), key=cost.__getitem__)
    chosen = [k]
    for step_back in reversed(back):
        k = step_back[k]
        chosen.append(k)
    chosen.reverse()
    # Where line.project finds the same pass, keep its exact point
    line = LineString(coords)
    alongs = []
    for stop, opts, k in zip(stops, options, chosen, strict=True):
        projected = line.project(Point(stop["coords"]))
        same = abs(projected - opts[k].along) <= ORDER_SLACK
        alongs.append(projected if same else opts[k].along)
    return alongs


def snap_stops(
    route_coords: list[tuple[float, float]], stops: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """
    Snaps stops to the route line and calculates distance along route.
    """
    if len(route_coords) < 2:
        return []

    alongs = _monotonic_stop_alongs(np.asarray(route_coords, dtype=float), stops)
    processed_stops = []

    for stop, distance_along_route in zip(stops, alongs, strict=True):
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


@dataclass(frozen=True)
class PreviousPosition:
    """Where the same trip was matched last time."""

    # Distance along the route, in line units (RouteGeometry.line)
    along: float
    # Unix time of that position report
    at: float
    # Length of the line it was measured on, to ignore a changed geometry
    line_length: float


class _Timetable:
    """Scheduled time at any point along the route, from the snapped stops."""

    def __init__(
        self,
        stoptimes: list[dict[str, Any]],
        processed_stops: list[dict[str, Any]],
        metres_per_unit: float,
    ) -> None:
        self.alongs: list[float] = []
        self.arrivals: list[float] = []
        self.departures: list[float] = []
        for stop in processed_stops:
            st = stoptimes[stop["index"]]
            arr = st.get("scheduledArrival")
            dep = st.get("scheduledDeparture")
            if arr is None and dep is None:
                continue
            self.alongs.append(stop["distanceAlongRoute"])
            self.arrivals.append(arr if arr is not None else dep)
            self.departures.append(dep if dep is not None else arr)
        self.near = AT_STOP_M / metres_per_unit if metres_per_unit > 0 else 0.0

    def implied_delay(self, along: float, now: float) -> float:
        """Delay if the train were at `along` now (seconds; 0 if on time)."""
        if not self.alongs:
            return 0.0
        i = bisect.bisect_right(self.alongs, along) - 1
        if i < 0:
            # Before the first stop: waiting to start
            lo, hi = -math.inf, self.departures[0]
        elif i == len(self.alongs) - 1:
            lo, hi = self.arrivals[i], math.inf
        else:
            leg = self.alongs[i + 1] - self.alongs[i]
            share = (along - self.alongs[i]) / leg if leg > 0 else 1.0
            dep, arr = self.departures[i], self.arrivals[i + 1]
            lo = hi = dep + (arr - dep) * share
            # Standing at either stop, any time it is there is on time
            if along - self.alongs[i] <= self.near:
                lo = min(lo, self.arrivals[i])
            if self.alongs[i + 1] - along <= self.near:
                hi = max(hi, self.departures[i + 1])
        if now > hi:
            return now - hi
        if now < lo:
            return now - lo
        return 0.0


def _heading_against(bearing: float, heading: float) -> bool:
    diff = abs(heading - bearing) % 360
    return min(diff, 360 - diff) > 90


def locate_on_route(
    candidates: list[Candidate],
    timetable: _Timetable,
    now: float,
    metres_per_unit: float,
    heading: float | None,
    speed: float | None,
    previous: PreviousPosition | None,
    reported_at: float,
) -> float | None:
    """
    Distance along the route of the pass the train is on: of the passes
    within MATCH_SLACK_M of the nearest, the one closest to where the train is
    expected by its timetable, its previous position and its heading. Each
    costs seconds (see the constants above); the cheapest wins. If even that
    one would make the train more than IMPLAUSIBLY_EARLY_S early, passes up
    to FAR_MATCH_M away compete too (at METRE_COST_S per extra metre).

    None when the route passes by only once and the nearest point is
    plausible: the caller keeps its plain projection.
    """
    if not candidates:
        return None
    nearest = min(c.metres for c in candidates)
    near = [c for c in candidates if c.metres <= nearest + MATCH_SLACK_M]
    moving = heading is not None and speed is not None and speed > STANDING_MAX_MPS
    window: tuple[float, float] | None = None
    if previous is not None and metres_per_unit > 0:
        age = reported_at - previous.at
        if 0 <= age <= PREVIOUS_MAX_AGE_S:
            reach = max(PREVIOUS_MIN_REACH_M, PREVIOUS_MAX_MPS * age)
            window = (
                previous.along - PREVIOUS_BACK_M / metres_per_unit,
                previous.along + reach / metres_per_unit,
            )

    def cost(c: Candidate) -> float:
        delay = timetable.implied_delay(c.along, now)
        total = delay if delay >= 0 else -delay * EARLY_WEIGHT
        total += (c.metres - nearest) * METRE_COST_S
        if moving and heading is not None and _heading_against(c.bearing, heading):
            total += AGAINST_HEADING_S
        if window is not None and not window[0] <= c.along <= window[1]:
            total += OFF_PREVIOUS_S
        return total

    best = min(near, key=cost)
    if timetable.implied_delay(best.along, now) >= -IMPLAUSIBLY_EARLY_S:
        return best.along if len(near) > 1 else None
    if len(candidates) == len(near):
        return best.along if len(near) > 1 else None
    return min(candidates, key=cost).along


def dwell_stop_index(
    stoptimes: list[dict[str, Any]],
    processed_stops: list[dict[str, Any]],
    vehicle_progress: dict[str, Any],
    train_position: float,
    metres_per_unit: float,
    speed: float | None,
    current_time: float | None = None,
) -> int | None:
    """
    Index of the stop the vehicle is standing at, if any. The final stop is
    never a dwell: the trip ends there. An unknown speed counts as standing.

    - Its last passed or next stop, within AT_STOP_M (AT_ORIGIN_M at the
      first) along the route, and not moving (STANDING_MAX_MPS).
    - Its last passed stop before that stop's scheduled departure, up to
      BEFORE_DEPARTURE_M past it and slower than LEAVING_MPS: shunting,
      creeping to the platform end or GPS noise during a long stop. It has
      left once it is further on or faster.
    """
    standing = speed is None or speed <= STANDING_MAX_MPS
    slow = speed is None or speed <= LEAVING_MPS
    if not slow:
        return None
    along_by_index = {
        stop.get("index"): stop["distanceAlongRoute"] for stop in processed_stops
    }
    last_index = vehicle_progress.get("lastStopIndex")
    best: tuple[float, int] | None = None
    for index in (last_index, vehicle_progress.get("nextStopIndex")):
        if index is None or index >= len(stoptimes) - 1:
            continue
        along = along_by_index.get(index)
        if along is None:
            continue
        metres = abs(train_position - along) * metres_per_unit
        near = AT_ORIGIN_M if index == 0 else AT_STOP_M
        departure = stoptimes[index].get("scheduledDeparture")
        at_stop = standing and metres <= near
        waiting = (
            index == last_index
            and current_time is not None
            and departure is not None
            and current_time < departure
            and train_position >= along
            and metres <= max(near, BEFORE_DEPARTURE_M)
        )
        if (at_stop or waiting) and (best is None or metres < best[0]):
            best = (metres, index)
    return best[1] if best else None


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
    # m/s; None when the feed has none
    speed: float | None = None,
    # Where the same trip was matched last time, if known
    previous: PreviousPosition | None = None,
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

    metres_per_unit = 0.0
    if route.line is not None and route.line.length > 0:
        metres_per_unit = route.length_km * 1000 / route.line.length

    # Train position along route, computed once. Where the route passes the
    # position more than once, the pass the train is expected on.
    train_position = 0.0
    off_route_m: float | None = None
    if route.line is not None:
        line = route.line
        vehicle_point = Point(lon, lat)
        candidates = [
            c
            for c in projection_candidates(route.coords_array, lon, lat, FAR_MATCH_M)
            if c.metres <= FAR_MATCH_M
        ] or projection_candidates(route.coords_array, lon, lat, MATCH_SLACK_M)
        if previous is not None and not math.isclose(
            previous.line_length, line.length, rel_tol=1e-6
        ):
            previous = None
        located = locate_on_route(
            candidates,
            _Timetable(stoptimes, list(processed_stops), metres_per_unit),
            current_time,
            metres_per_unit,
            heading,
            speed,
            previous,
            calculate_date.timestamp(),
        )
        train_position = (
            located
            if located is not None
            else project_with_heading(line, vehicle_point, heading, route.coords_array)
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

    # Standing at a stop: the train leaves at its scheduled departure at the
    # earliest, so it is never early there. Interpolating against the timetable
    # would make a train waiting out a long stop look up to its whole dwell
    # time early (or, short of the stop's point, late).
    dwell_index = None
    if metres_per_unit > 0:
        dwell_index = dwell_stop_index(
            stoptimes,
            list(processed_stops),
            vehicle_progress,
            train_position,
            metres_per_unit,
            speed,
            current_time,
        )
    if dwell_index is not None:
        departure = stoptimes[dwell_index].get("scheduledDeparture")
        if departure is not None:
            delay = max(0, current_time - departure)
        # Held well short of a stop it has not reached: it arrives late, and
        # measuring against the departure would hide the stop's dwell time
        arrival = stoptimes[dwell_index].get("scheduledArrival")
        along = next(
            (
                s["distanceAlongRoute"]
                for s in processed_stops
                if s.get("index") == dwell_index
            ),
            None,
        )
        if (
            arrival is not None
            and along is not None
            and dwell_index == next_index
            and dwell_index != last_index
            and (along - train_position) * metres_per_unit > HELD_SHORT_M
        ):
            delay = max(delay, current_time - arrival)

    return {
        "delay": delay,
        "dwellStopIndex": dwell_index,
        "trainPosition": train_position,
        "totalRouteDistance": total_route_distance,
        "processedStops": processed_stops_with_info,
        "vehicleProgress": vehicle_progress,
        "offRouteMeters": off_route_m,
    }
