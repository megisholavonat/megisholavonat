"""Stop identifiers and types"""

from typing import Any, Literal


def station_id_from_gtfs_id(gtfs_id: str) -> str:
    """
    UIC station code from a platform-level stop gtfsId: drop the feed prefix and
    the platform suffix, e.g. `1:005501024_14` or `1:005505876_5b` -> `005501024`.
    """
    return gtfs_id.split(":", 1)[-1].split("_", 1)[0]


def platform_from_gtfs_id(gtfs_id: str) -> str | None:
    """`1:005501024_14` -> `14`: the platform a platform-level stop stands for."""
    local = gtfs_id.split(":", 1)[-1]
    _, sep, platform = local.partition("_")
    return (platform or None) if sep else None


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


# What a stop of the rail feed is: a railway station or halt (MÁV, GYSEV and
# foreign railways), a HÉV stop, a stop of the Szeged-Hódmezővásárhely
# tram-train or a station of the Children's Railway
StationType = Literal["rail", "hev", "tramtrain", "childrens_railway"]

# Agencies told apart by name: their gtfsIds are feed-internal numbers
HEV_AGENCY = "(HÉV)"  # "MÁV Személyszállítási Zrt. (HÉV)"
CHILDRENS_RAILWAY_AGENCY = "Gyermekvasút"
# A stop served by more than one kind is the first of these
STATION_TYPE_ORDER: tuple[StationType, ...] = (
    "rail",
    "hev",
    "tramtrain",
    "childrens_railway",
)


def _route_type(route: dict[str, Any]) -> StationType | None:
    mode = route.get("mode")
    if mode == "RAIL_REPLACEMENT_BUS":
        return None
    agency = (route.get("agency") or {}).get("name") or ""
    if CHILDRENS_RAILWAY_AGENCY in agency:
        return "childrens_railway"
    if HEV_AGENCY in agency:
        return "hev"
    if mode == "TRAMTRAIN":
        return "tramtrain"
    return "rail"


def station_type(station: dict[str, Any]) -> StationType:
    """
    What kind of stop an OTP station is, from the mode and agency of the
    routes serving it, never from its name. German and Austrian S-Bahns are
    SUBURBAN_RAILWAY too, so the HÉV is told apart by its agency. A station
    without routes counts as a railway station.
    """
    types = {_route_type(r) for r in station.get("routes") or []}
    return next((t for t in STATION_TYPE_ORDER if t in types), "rail")
