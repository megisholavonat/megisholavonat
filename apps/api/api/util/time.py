from datetime import datetime

import pytz

BUDAPEST_TZ = pytz.timezone("Europe/Budapest")


def get_seconds_since_day(since_date_str: str, date: datetime) -> int:
    """
    Calculates seconds since midnight on a given date.
    """
    if date.tzinfo is None:
        date = pytz.utc.localize(date)

    # Convert input date to Budapest time
    budapest_date = date.astimezone(BUDAPEST_TZ)

    # Calculate seconds since midnight for the current day
    seconds_since_midnight = (
        budapest_date.hour * 3600 + budapest_date.minute * 60 + budapest_date.second
    )

    # Parse service date (YYYY-MM-DD) and localize to Budapest midnight
    try:
        since_date_naive = datetime.strptime(since_date_str, "%Y-%m-%d")
        since_date_local = BUDAPEST_TZ.localize(since_date_naive)

        # Create midnight version of budapest_date for accurate day diff
        current_day_midnight = budapest_date.replace(
            hour=0, minute=0, second=0, microsecond=0
        )

        delta = current_day_midnight - since_date_local
        days_since = delta.days

        return seconds_since_midnight + (days_since * 86400)

    except ValueError:
        # Fallback if date parsing fails
        return seconds_since_midnight
