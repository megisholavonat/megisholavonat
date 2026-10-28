"""
Links into MÁV's ticket shop.

The shop reads the search from the query string and starts it on load: both
stations as UIC codes and the boarding time in UTC, each wrapped in a JSON
array. There is no parameter for a specific train.

Mirrors packages/core/src/ticket.ts; the tests of both share the same cases.
"""

import json
from datetime import UTC, datetime
from urllib.parse import urlencode

TICKET_SHOP_URL = "https://jegy.mav.hu/"


def _iso_utc(unix_seconds: int) -> str:
    # Same shape as JavaScript's Date.toISOString()
    when = datetime.fromtimestamp(unix_seconds, UTC)
    return when.strftime("%Y-%m-%dT%H:%M:%S.") + f"{when.microsecond // 1000:03d}Z"


def ticket_url(from_uic: str | None, to_uic: str | None, departure: int | None) -> str:
    """
    Shop link searching from `from_uic` to `to_uic` at `departure` (unix
    seconds). Falls back to the shop's start page if anything is missing.
    """
    if not from_uic or not to_uic or departure is None:
        return TICKET_SHOP_URL

    def array(value: str) -> str:
        return json.dumps([value], separators=(",", ":"))

    query = urlencode(
        {
            "from_ticketing_stop_time_id": array(from_uic),
            "to_ticketing_stop_time_id": array(to_uic),
            "boarding_time": array(_iso_utc(departure)),
            "lang": "hu",
        }
    )
    return f"{TICKET_SHOP_URL}?{query}"
