import itertools
import math

import numpy as np
import polyline  # type: ignore[import-untyped]
import pytest
from shapely.geometry import LineString, Point

from api.util.preprocess import calculate_bearing
from api.util.route import (
    best_aligned_projection,
    route_from_polyline,
    route_length,
)


def _reference(
    coords: list[tuple[float, float]], point: Point, heading: float
) -> float | None:
    """The original per-segment loop, kept as the oracle."""
    best: float | None = None
    min_dist, current = math.inf, 0.0
    for p1, p2 in itertools.pairwise(coords):
        seg_len = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
        if seg_len == 0:
            continue
        diff = abs(heading - calculate_bearing(p1, p2))
        if diff > 180:
            diff = 360 - diff
        if diff <= 90:
            seg = LineString([p1, p2])
            dist = seg.distance(point)
            if dist < min_dist:
                min_dist, best = dist, current + seg.project(point)
        current += seg_len
    return best


# Out and back with a loop, so several segments are near any point
LOOP = [
    (19.0, 47.0),
    (19.1, 47.0),
    (19.15, 47.05),
    (19.1, 47.1),
    (19.05, 47.05),
    (19.1, 47.0),
    (19.2, 47.0),
]


@pytest.mark.parametrize("heading", [0, 45, 90, 135, 180, 225, 270, 315, 359])
@pytest.mark.parametrize("point", [(19.1, 47.001), (19.12, 47.04), (19.07, 47.06)])
def test_vectorized_projection_matches_reference(
    heading: float, point: tuple[float, float]
) -> None:
    got = best_aligned_projection(np.asarray(LOOP), *point, heading)
    expected = _reference(LOOP, Point(point), heading)

    if expected is None:
        assert got is None
    else:
        assert got == pytest.approx(expected, abs=1e-12)


def test_route_is_cached_per_polyline() -> None:
    points = polyline.encode([(lat, lon) for lon, lat in LOOP])

    route = route_from_polyline(points)

    assert route_from_polyline(points) is route
    assert route.line is not None
    assert len(route.coords) == len(LOOP) - 1  # repeated point removed
    assert route.length_km == route_length([(lat, lon) for lon, lat in LOOP])
