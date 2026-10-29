"""Delay units"""

import math


def to_minutes(seconds: float) -> int:
    """
    A delay in whole minutes, rounding halves up (150 s -> 3, -150 s -> -2) as
    JavaScript's Math.round does, not to even as Python's round().
    """
    return math.floor(seconds / 60 + 0.5)
