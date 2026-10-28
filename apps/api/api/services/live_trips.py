"""Matching OTP trips to the trains live on our map.

All matching lives here so it can be switched to trip gtfsIds only once the
live data carries them everywhere.
"""

import json
from dataclasses import dataclass
from typing import Any

from redis.asyncio import Redis

from api.core.redis import add_key

LIVE_INDEX_TTL = 30  # seconds; live positions refresh every minute

# Marks a fallback key shared by several live trains, which is never matched
_AMBIGUOUS = "ambiguous"


@dataclass(frozen=True, slots=True)
class LiveTrip:
    vehicleId: str
    delay: int  # minutes, GPS-derived


def _id_key(trip_id: str) -> str:
    return f"id:{trip_id}"


def _fallback_key(
    service_date: str, trip_short_name: str, origin_departure: int
) -> str:
    # Train numbers repeat within a day, so the trip is pinned down by its
    # service date, full name and scheduled departure from its origin.
    return f"fb:{service_date}|{trip_short_name}|{origin_departure}"


def build_live_trip_index(
    locations: list[dict[str, Any]],
) -> dict[str, dict[str, Any] | str]:
    """Map match keys of each live train to its vehicle id and delay."""
    index: dict[str, dict[str, Any] | str] = {}
    for loc in locations:
        trip = loc.get("trip") or {}
        vehicle_id = loc.get("vehicleId")
        delay = loc.get("delay")
        if not vehicle_id or delay is None:
            continue
        value = {"vehicleId": vehicle_id, "delay": delay}

        trip_id = trip.get("gtfsId")
        if trip_id:
            index[_id_key(trip_id)] = value

        stoptimes = trip.get("stoptimes") or []
        if trip.get("serviceDate") and trip.get("tripShortName") and stoptimes:
            key = _fallback_key(
                trip["serviceDate"],
                trip["tripShortName"],
                stoptimes[0].get("scheduledDeparture"),
            )
            index[key] = _AMBIGUOUS if key in index else value
    return index


def match_live_trip(
    index: dict[str, dict[str, Any] | str],
    trip_id: str,
    service_date: str,
    trip_short_name: str,
    origin_departure: int | None,
) -> LiveTrip | None:
    """Find the live train running an OTP trip, by gtfsId if possible."""
    candidates = [_id_key(trip_id)]
    if origin_departure is not None:
        candidates.append(
            _fallback_key(service_date, trip_short_name, origin_departure)
        )

    for key in candidates:
        value = index.get(key)
        if isinstance(value, dict):
            return LiveTrip(vehicleId=value["vehicleId"], delay=int(value["delay"]))
    return None


async def load_live_trip_index(redis: Redis) -> dict[str, dict[str, Any] | str]:
    """
    The index is derived from the live positions hash and cached briefly, so
    board requests do not each parse every live train.
    """
    cache_key = add_key("live-trip-index")
    cached = await redis.get(cache_key)
    if cached is not None:
        result: dict[str, dict[str, Any] | str] = json.loads(cached)
        return result

    raw_locations = await redis.hvals(add_key("train-positions-hash"))  # type: ignore[misc]
    index = build_live_trip_index([json.loads(raw) for raw in raw_locations])
    await redis.set(cache_key, json.dumps(index), ex=LIVE_INDEX_TTL)
    return index
