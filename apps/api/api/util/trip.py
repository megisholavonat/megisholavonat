"""Helpers for a trip's scheduled time window."""

from datetime import UTC, date, datetime, timedelta
from typing import Any

from api.util.time import get_seconds_since_day

# A vehicle may show up a little before its first scheduled departure
IN_SERVICE_BEFORE_S = 10 * 60
# ... and is still running its trip for a while after the last arrival if late
IN_SERVICE_AFTER_S = 30 * 60
# A neighbouring service date replaces the trip's own only if it puts the
# position time at least this much closer to the trip's schedule
SERVICE_DATE_MISMATCH_S = 12 * 3600


def seconds_into_service_day(trip: dict[str, Any], unix_time: float) -> int:
    """
    Seconds since the start of the trip's service day, the same clock the
    stoptimes use. Exceeds 86400 for trips past midnight.

    OTP's `serviceDate` does not always match the day the stoptimes count
    from: HÉV trips after midnight carry the previous day's date with
    stoptimes under 86400, and an overnight train can carry the next day's
    date while still running the previous day's departure. Taken at face
    value, either is off by a whole day (a delay of about ±1440 min), so when
    the previous or next date puts `unix_time` far closer to the trip's
    schedule, that date is used instead.
    """
    when = datetime.fromtimestamp(unix_time, tz=UTC)
    service_date = trip.get("serviceDate", "")
    now = get_seconds_since_day(service_date, when)
    window = expected_window(trip)
    if window is None:
        return now
    try:
        day = date.fromisoformat(service_date)
    except ValueError:
        return now

    # Another date has to beat this to be used
    best, to_beat = now, _outside(window, now) - SERVICE_DATE_MISMATCH_S
    for offset in (-1, 1):
        other_date = (day + timedelta(days=offset)).isoformat()
        other = get_seconds_since_day(other_date, when)
        outside = _outside(window, other)
        if outside <= to_beat:
            best, to_beat = other, outside - 1
    return best


def _outside(window: tuple[int, int], now: int) -> int:
    first, last = window
    return max(0, first - now, now - last)


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
    return _outside(window, seconds_into_service_day(trip, unix_time))


def is_in_service(trip: dict[str, Any], unix_time: float) -> bool:
    """Whether `unix_time` falls within the trip's expected window (with margins)."""
    window = expected_window(trip)
    if window is None or not trip.get("serviceDate"):
        return False
    now = seconds_into_service_day(trip, unix_time)
    first, last = window
    return first - IN_SERVICE_BEFORE_S <= now <= last + IN_SERVICE_AFTER_S
