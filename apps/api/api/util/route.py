"""
Route geometry, built once per trip polyline and reused across refreshes.

A trip's geometry and stops do not change from one minute to the next, so the
decoded polyline, the shapely line, the route length and the snapped stops are
cached; only the vehicle's own projection is computed per observation.
"""

import functools
import itertools
import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import polyline  # type: ignore[import-untyped]
from shapely.geometry import LineString

# Distinct trip geometries kept in memory. A day has a few hundred trips on
# the map at once; each entry is a line of up to ~1000 points.
ROUTE_CACHE_SIZE = 1024


def route_length(route_coords: list[tuple[float, float]]) -> float:
    """
    Returns the total haversine length of the route in km.
    """
    total = 0.0
    for (lat1, lon1), (lat2, lon2) in itertools.pairwise(route_coords):
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = phi2 - phi1
        dlam = math.radians(lon2 - lon1)
        a = (
            math.sin(dphi / 2) ** 2
            + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
        )
        total += 2 * 6371.0 * math.asin(min(1.0, math.sqrt(a)))
    return total


@dataclass(eq=False)
class RouteGeometry:
    # Unique [lon, lat] points in route order (GeoJSON order, as shapely uses)
    coords: list[tuple[float, float]]
    line: LineString | None
    length_km: float
    _coords_array: np.ndarray | None = field(default=None, repr=False)

    @classmethod
    def from_latlon(cls, route_coords: list[tuple[float, float]]) -> "RouteGeometry":
        """Build from polyline-decoded [lat, lon] points."""
        unique: list[tuple[float, float]] = []
        seen: set[tuple[float, float]] = set()
        for lat, lon in route_coords:
            point = (lon, lat)
            if point not in seen:
                unique.append(point)
                seen.add(point)
        return cls(
            coords=unique,
            line=LineString(unique) if len(unique) >= 2 else None,
            length_km=route_length(route_coords),
        )

    @property
    def coords_array(self) -> np.ndarray:
        if self._coords_array is None:
            self._coords_array = np.asarray(self.coords, dtype=float)
        return self._coords_array


@functools.lru_cache(maxsize=ROUTE_CACHE_SIZE)
def route_from_polyline(points: str) -> RouteGeometry:
    return RouteGeometry.from_latlon(polyline.decode(points))


# Tolerance of the train list's route lines, in degrees (about 4-5 m)
LIST_POLYLINE_TOLERANCE = 0.00005


@functools.lru_cache(maxsize=ROUTE_CACHE_SIZE)
def simplified_polyline(points: str) -> str:
    """
    The trip polyline thinned to LIST_POLYLINE_TOLERANCE, for the train list.
    Clients only move markers along it between position reports, so a few
    metres are invisible, and it removes about two thirds of the points (the
    bulk of /v1/trains). Details keep the full geometry.
    """
    try:
        coords = polyline.decode(points)
    except (ValueError, IndexError, TypeError):
        return points
    if len(coords) < 3:
        return points
    line = LineString(coords).simplify(LIST_POLYLINE_TOLERANCE, preserve_topology=False)
    return str(polyline.encode([(float(x), float(y)) for x, y in line.coords]))


StopsKey = tuple[tuple[Any, Any, Any, Any, Any], ...]


@functools.lru_cache(maxsize=4 * ROUTE_CACHE_SIZE)
def snapped_stops(route: RouteGeometry, stops: StopsKey) -> tuple[dict[str, Any], ...]:
    """
    Stops `(id, gtfsId, index, lon, lat)` snapped to the route and sorted by
    distance along it. Cached per route object; callers must not mutate.
    """
    from api.util.preprocess import snap_stops

    return tuple(
        snap_stops(
            route.coords,
            [
                {"id": i, "gtfsId": g, "index": idx, "coords": [lon, lat]}
                for i, g, idx, lon, lat in stops
            ],
        )
    )


@dataclass(frozen=True)
class Candidate:
    """A place on the route the GPS position may be matched to."""

    # Distance along the line, in the line's (degree) units like line.project
    along: float
    # Metres from the GPS position
    metres: float
    # Bearing of the route there, in degrees
    bearing: float


# Metres per degree of latitude, and of longitude at the equator
_M_PER_DEG_LAT = 110_540.0
_M_PER_DEG_LON = 111_320.0


def projection_candidates(
    coords: np.ndarray, x: float, y: float, slack_m: float
) -> list[Candidate]:
    """
    Every place where the route passes the point (x, y) = (lon, lat): the
    nearest point of each pass, i.e. each local minimum of the distance along
    the line, if it is at most `slack_m` further than the nearest one. A route
    that passes a place once has one candidate; a loop, an out-and-back or a
    near self-intersection has one per pass, in route order.
    """
    if len(coords) < 2:
        return []
    p1 = coords[:-1]
    p2 = coords[1:]
    vec = p2 - p1
    seg_len = np.sqrt(vec[:, 0] ** 2 + vec[:, 1] ** 2)

    # The foot point in degrees, as shapely's project, so the nearest pass
    # is where line.project puts it
    with np.errstate(divide="ignore", invalid="ignore"):
        t = ((x - p1[:, 0]) * vec[:, 0] + (y - p1[:, 1]) * vec[:, 1]) / seg_len**2
    t = np.clip(np.nan_to_num(t), 0.0, 1.0)
    # Its distance in local equirectangular metres around the point
    kx = _M_PER_DEG_LON * math.cos(math.radians(y))
    ky = _M_PER_DEG_LAT
    metres = np.hypot(
        (x - (p1[:, 0] + t * vec[:, 0])) * kx, (y - (p1[:, 1] + t * vec[:, 1])) * ky
    )
    metres = np.where(seg_len != 0, metres, np.inf)

    # Local minima; on a plateau (the point projects onto a shared vertex) the
    # last segment of it
    left = np.r_[np.inf, metres[:-1]]
    right = np.r_[metres[1:], np.inf]
    nearest = float(metres.min())
    keep = (metres <= left) & (metres < right) & (metres <= nearest + slack_m)
    indices = np.flatnonzero(keep)

    offsets = np.r_[0.0, np.cumsum(seg_len)]
    lat1 = np.radians(p1[indices, 1])
    lat2 = np.radians(p2[indices, 1])
    d_lon = np.radians(p2[indices, 0] - p1[indices, 0])
    bearing = (
        np.degrees(
            np.arctan2(
                np.sin(d_lon) * np.cos(lat2),
                np.cos(lat1) * np.sin(lat2)
                - np.sin(lat1) * np.cos(lat2) * np.cos(d_lon),
            )
        )
        + 360
    ) % 360
    return [
        Candidate(
            along=float(offsets[i] + t[i] * seg_len[i]),
            metres=float(metres[i]),
            bearing=float(b),
        )
        for i, b in zip(indices, bearing, strict=True)
    ]


def best_aligned_projection(
    coords: np.ndarray, x: float, y: float, heading: float
) -> float | None:
    """
    Distance along the line of the closest point on any segment whose bearing
    is within 90 degrees of `heading` (first such segment on ties), or None if
    no segment is aligned. Vectorized form of the per-segment search.
    """
    if len(coords) < 2:
        return None
    p1 = coords[:-1]
    p2 = coords[1:]
    vec = p2 - p1
    seg_len = np.sqrt(vec[:, 0] ** 2 + vec[:, 1] ** 2)

    # Bearing of each segment, same formula as calculate_bearing
    lat1 = np.radians(p1[:, 1])
    lat2 = np.radians(p2[:, 1])
    d_lon = np.radians(p2[:, 0] - p1[:, 0])
    b_y = np.sin(d_lon) * np.cos(lat2)
    b_x = np.cos(lat1) * np.sin(lat2) - np.sin(lat1) * np.cos(lat2) * np.cos(d_lon)
    bearing = (np.degrees(np.arctan2(b_y, b_x)) + 360) % 360

    diff = np.abs(heading - bearing)
    diff = np.where(diff > 180, 360 - diff, diff)
    aligned = (diff <= 90) & (seg_len != 0)
    if not aligned.any():
        return None

    with np.errstate(divide="ignore", invalid="ignore"):
        t = ((x - p1[:, 0]) * vec[:, 0] + (y - p1[:, 1]) * vec[:, 1]) / seg_len**2
    t = np.clip(np.nan_to_num(t), 0.0, 1.0)
    dist = np.hypot(x - (p1[:, 0] + t * vec[:, 0]), y - (p1[:, 1] + t * vec[:, 1]))
    dist = np.where(aligned, dist, np.inf)

    i = int(np.argmin(dist))
    # Sequential sum, like the original running total
    offset = float(np.cumsum(seg_len)[i - 1]) if i else 0.0
    return offset + float(t[i] * seg_len[i])
