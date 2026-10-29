"""
Rules shared by the delay history (recording, statistics), the forecast
(training and serving) and the push alerts. Keep them in one place so the
parts cannot drift apart.
"""

# A train counts as on time when it is at most this late (inclusive)
ON_TIME_THRESHOLD_S = 5 * 60

# Default look-back of the history statistics, in service dates
DEFAULT_HISTORY_DAYS = 28

# Positions further than this from the trip geometry belong to another trip
# (vehicles are pre-assigned to their next trip) or are GPS noise
MAX_OFF_ROUTE_M = 500
# Delays beyond this are data errors
MAX_ABS_DELAY_S = 6 * 3600

# A platform prediction is shown (and stands in for the schedule in push
# alerts) only if this share of at least this many recent passages used it
PLATFORM_MIN_CONFIDENCE = 0.8
PLATFORM_MIN_RUNS = 5


def platform_confident(confidence: float, n: int) -> bool:
    """Whether a platform prediction is sure enough to show."""
    return confidence >= PLATFORM_MIN_CONFIDENCE and n >= PLATFORM_MIN_RUNS
