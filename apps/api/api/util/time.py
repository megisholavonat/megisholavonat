import math
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

BUDAPEST_TZ = ZoneInfo("Europe/Budapest")


def service_day_start(service_date: date) -> datetime:
    """
    The instant a service day's stoptime seconds count from: local noon minus
    12 hours, as in GTFS and OTP (`serviceDay`). This is local midnight except
    on DST change days, where it is 23:00 (spring) or 01:00 (autumn) the night
    before, so times after the change still read as wall-clock times.
    """
    noon = datetime.combine(service_date, time(12), tzinfo=BUDAPEST_TZ)
    # Subtract in UTC; aware-datetime arithmetic in a zone is wall-clock based
    return noon.astimezone(UTC) - timedelta(hours=12)


def get_seconds_since_day(since_date_str: str, date: datetime) -> int:
    """
    Seconds from the start of the service day `since_date_str` (YYYY-MM-DD)
    to `date`, the clock OTP stoptimes use. Exceeds 86400 past midnight.
    """
    if date.tzinfo is None:
        date = date.replace(tzinfo=UTC)

    try:
        service_date = datetime.strptime(since_date_str, "%Y-%m-%d").date()
    except ValueError:
        # Unknown service date: assume today's (local) service day
        service_date = date.astimezone(BUDAPEST_TZ).date()

    return math.floor((date - service_day_start(service_date)).total_seconds())
