"""Stop identifiers"""

from typing import Any


def station_id_from_gtfs_id(gtfs_id: str) -> str:
    """
    UIC station code from a platform-level stop gtfsId: drop the feed prefix and
    the platform suffix, e.g. `1:005501024_14` or `1:005505876_5b` -> `005501024`.
    """
    return gtfs_id.split(":", 1)[-1].split("_", 1)[0]


def station_id(stop: dict[str, Any]) -> str | None:
    """
    Station-level id of a stop: OTP's stationUicPricingCode when present,
    otherwise derived from the gtfsId (recorded snapshots lack the UIC code).
    """
    uic = stop.get("stationUicPricingCode")
    if uic:
        return str(uic)
    gtfs_id = stop.get("gtfsId")
    return station_id_from_gtfs_id(gtfs_id) if gtfs_id else None
