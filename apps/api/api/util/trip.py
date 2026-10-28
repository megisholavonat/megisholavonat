"""Helpers for a trip's scheduled time window."""

from datetime import UTC, datetime
from typing import Any

from api.util.time import get_seconds_since_day

# A vehicle may show up a little before its first scheduled departure
IN_SERVICE_BEFORE_S = 10 * 60
# ... and is still running its trip for a while after the last arrival if late
IN_SERVICE_AFTER_S = 30 * 60


def seconds_into_service_day(trip: dict[str, Any], unix_time: float) -> int:
    """
    Seconds since local (Europe/Budapest) midnight of the trip's service date,
    the same clock the stoptimes use. Exceeds 86400 for trips past midnight.
    """
    return get_seconds_since_day(
        trip.get("serviceDate", ""), datetime.fromtimestamp(unix_time, tz=UTC)
    )


def scheduled_window(trip: dict[str, Any]) -> tuple[int, int] | None:
    """(first scheduled departure, last scheduled arrival), or None if unknown."""
    stoptimes = trip.get("stoptimes") or []
    if not stoptimes:
        return None
    first = stoptimes[0].get("scheduledDeparture")
    last = stoptimes[-1].get("scheduledArrival")
    if first is None or last is None:
        return None
    return first, last


def expected_window(trip: dict[str, Any]) -> tuple[int, int] | None:
    """
    Like `scheduled_window`, but shifted by the realtime estimate when there is
    one, so a late train still counts as running past its scheduled end.
    """
    window = scheduled_window(trip)
    if window is None:
        return None
    stoptimes = trip["stoptimes"]
    first = stoptimes[0].get("realtimeDeparture") or window[0]
    last = stoptimes[-1].get("realtimeArrival") or window[1]
    return min(first, window[0]), max(last, window[1])


def seconds_outside_window(trip: dict[str, Any], unix_time: float) -> float:
    """
    How far `unix_time` is outside the trip's expected window, in seconds:
    0 while it should be running, inf if the schedule is unknown.
    """
    window = expected_window(trip)
    if window is None or not trip.get("serviceDate"):
        return float("inf")
    now = seconds_into_service_day(trip, unix_time)
    first, last = window
    return max(0, first - now, now - last)


def is_in_service(trip: dict[str, Any], unix_time: float) -> bool:
    """Whether `unix_time` falls within the trip's expected window (with margins)."""
    window = expected_window(trip)
    if window is None or not trip.get("serviceDate"):
        return False
    now = seconds_into_service_day(trip, unix_time)
    first, last = window
    return first - IN_SERVICE_BEFORE_S <= now <= last + IN_SERVICE_AFTER_S
