"""
Resolve a commute (a train number taken on some weekdays from a station) to
the concrete trip running on a given day.

Only the live positions in Redis are used: a commute resolves while its train
is on the map (vehicles are attached to their trip a little before it
departs), and to None otherwise. No upstream query is made.
"""

import json
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Protocol

from redis.asyncio import Redis

from api.core.redis import add_key
from api.util.stop import station_id

DAY_S = 24 * 3600


class Commute(Protocol):
    """The fields of a commute follow (see api.models.devices.Follow)."""

    trip_short_name: str
    # ISO weekday bitmask, bit 0 = Monday
    weekdays: int | None
    from_station_id: str | None
    to_station_id: str | None


@dataclass(frozen=True, slots=True)
class ResolvedTrip:
    tripId: str
    serviceDate: date
    tripShortName: str
    vehicleId: str
    # Platform-level stop at the boarding station
    fromStopId: str
    # Seconds since midnight of the service date (above 86400 past midnight)
    scheduledDepartureS: int
    platform: str | None
    # Minutes, GPS-derived
    delayMin: int | None


def train_number(trip_short_name: str) -> str:
    """'559 AGRIA InterRégió' -> '559'; OTP prefixes the number to the name."""
    parts = trip_short_name.split()
    return parts[0].casefold() if parts else ""


def _station_index(stoptimes: list[dict[str, Any]], station: str) -> int | None:
    for i, st in enumerate(stoptimes):
        if station_id(st.get("stop") or {}) == station:
            return i
    return None


def find_commute_trip(
    locations: Iterable[dict[str, Any]], commute: Commute, day: date
) -> ResolvedTrip | None:
    """
    The trip among live `locations` (processed positions as cached in Redis)
    that `commute` refers to on `day`.

    `day` and the commute's weekdays are the local calendar day of departure
    from the boarding station. A train leaving the boarding station after
    midnight therefore resolves on the day after its service date.

    Train numbers repeat within a day, so a trip only matches if it stops at
    the boarding station (and later at the destination station, if set) on
    that day. Should several still match, the earliest departure wins.
    """
    if not commute.weekdays or not commute.weekdays & (1 << (day.isoweekday() - 1)):
        return None
    if not commute.from_station_id:
        return None
    number = train_number(commute.trip_short_name)
    if not number:
        return None

    best: ResolvedTrip | None = None
    for loc in locations:
        trip = loc.get("trip") or {}
        if train_number(trip.get("tripShortName") or "") != number:
            continue
        trip_id = trip.get("gtfsId")
        vehicle_id = loc.get("vehicleId")
        try:
            service_date = date.fromisoformat(trip.get("serviceDate") or "")
        except ValueError:
            continue
        if not trip_id or not vehicle_id:
            continue

        stoptimes = trip.get("stoptimes") or []
        board = _station_index(stoptimes, commute.from_station_id)
        if board is None:
            continue
        if commute.to_station_id is not None:
            alight = _station_index(stoptimes[board + 1 :], commute.to_station_id)
            if alight is None:
                continue

        st = stoptimes[board]
        departure = st.get("scheduledDeparture")
        if departure is None:
            departure = st.get("scheduledArrival")
        if departure is None:
            continue
        if service_date + timedelta(days=departure // DAY_S) != day:
            continue

        stop = st.get("stop") or {}
        delay = loc.get("delay")
        candidate = ResolvedTrip(
            tripId=trip_id,
            serviceDate=service_date,
            tripShortName=trip.get("tripShortName") or "",
            vehicleId=vehicle_id,
            fromStopId=stop.get("gtfsId") or "",
            scheduledDepartureS=departure,
            platform=stop.get("platformCode"),
            delayMin=None if delay is None else int(delay),
        )
        if best is None or _departs_at(candidate) < _departs_at(best):
            best = candidate
    return best


def _departs_at(trip: ResolvedTrip) -> int:
    """Comparable departure time across service dates (DST ignored)."""
    return trip.serviceDate.toordinal() * DAY_S + trip.scheduledDepartureS


async def resolve_commute_trip(
    redis: Redis,
    commute: Commute,
    day: date,
    locations: Iterable[dict[str, Any]] | None = None,
) -> ResolvedTrip | None:
    """
    Today's (or `day`'s) trip of a commute, if its train is live. Pass
    `locations` already read from Redis to resolve many commutes at once.
    """
    if locations is None:
        raw = await redis.hvals(add_key("train-positions-hash"))  # type: ignore[misc]
        locations = (json.loads(v) for v in raw)
    return find_commute_trip(locations, commute, day)
