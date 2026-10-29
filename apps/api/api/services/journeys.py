"""Journey planning between rail stations, on top of OTP's `plan` query."""

import time
from datetime import datetime
from typing import Any

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.cache import cached_model
from api.core.graphql import query_graphql
from api.core.queries import JOURNEYS_QUERY
from api.schemas.journeys import (
    Itinerary,
    JourneyLeg,
    JourneyPlan,
    JourneyStop,
    Transfer,
    TransitLeg,
    WalkLeg,
)
from api.schemas.stations import Station
from api.services.connection_risk import HISTORY_DAYS, assess_transfers
from api.services.insights import history_window
from api.services.live_trips import load_live_trip_index, match_live_trip
from api.services.station_board import keep_best, train_number
from api.services.station_index import RAIL_FEED, load_station_index
from api.util.ticket import ticket_url
from api.util.time import BUDAPEST_TZ

JOURNEYS_TTL = 60  # seconds
# OTP spends several of its itineraries on duplicates of the same trains
OVERFETCH = 2


class UnknownStationError(Exception):
    pass


class SameStationError(Exception):
    pass


def _stop(place: dict[str, Any]) -> JourneyStop:
    stop = place.get("stop") or {}
    return JourneyStop(
        id=stop.get("stationUicPricingCode"),
        name=place["name"],
        lat=place["lat"],
        lon=place["lon"],
        platform=stop.get("platformCode"),
    )


def _walk_leg(leg: dict[str, Any]) -> WalkLeg:
    return WalkLeg(
        fromStop=_stop(leg["from"]),
        toStop=_stop(leg["to"]),
        departureTime=leg["startTime"] // 1000,
        arrivalTime=leg["endTime"] // 1000,
        distanceMeters=round(leg.get("distance") or 0),
    )


def _transit_leg(leg: dict[str, Any], live_index: dict[str, Any]) -> TransitLeg:
    trip = leg["trip"]
    route = leg.get("route") or {}
    trip_short_name = trip.get("tripShortName") or ""
    service_date = leg.get("serviceDate") or ""

    departure_delay = leg.get("departureDelay") or 0
    arrival_delay = leg.get("arrivalDelay") or 0
    expected_departure = leg["startTime"] // 1000
    expected_arrival = leg["endTime"] // 1000
    scheduled_departure = expected_departure - departure_delay
    scheduled_arrival = expected_arrival - arrival_delay
    delay = round(departure_delay / 60)
    delay_source = "otp"
    realtime = bool(leg.get("realTime"))
    vehicle_id = None

    live = match_live_trip(
        live_index,
        trip_id=trip["gtfsId"],
        service_date=service_date,
        trip_short_name=trip_short_name,
        origin_departure=(trip.get("departureStoptime") or {}).get(
            "scheduledDeparture"
        ),
    )
    if live is not None:
        vehicle_id = live.vehicleId
    # As on boards: no live delay off route, arrived or cancelled
    if live is not None and live.has_delay:
        delay_source = "gps"
        realtime = True
        # Trains do not leave early; a negative GPS delay before departure
        # only means the train is waiting. They may arrive early, though.
        delay = max(live.delay, 0)
        expected_departure = scheduled_departure + delay * 60
        expected_arrival = max(scheduled_arrival + live.delay * 60, expected_departure)

    return TransitLeg(
        mode=leg["mode"],
        tripId=trip["gtfsId"],
        tripShortName=trip_short_name,
        trainNumber=train_number(trip_short_name),
        routeShortName=route.get("shortName") or "",
        routeLongName=route.get("longName"),
        routeTextColor=route.get("textColor"),
        headsign=leg.get("headsign"),
        serviceDate=service_date,
        fromStop=_stop(leg["from"]),
        toStop=_stop(leg["to"]),
        scheduledDeparture=scheduled_departure,
        expectedDeparture=expected_departure,
        scheduledArrival=scheduled_arrival,
        expectedArrival=expected_arrival,
        delayMinutes=delay,
        delaySource=delay_source,
        realtime=realtime,
        canceled=leg.get("realtimeState") == "CANCELED",
        intermediateStops=len(leg.get("intermediateStops") or []),
        vehicleId=vehicle_id,
    )


def _minutes(seconds: int) -> int:
    return round(seconds / 60)


def _transfers(legs: list[JourneyLeg], interlined: list[bool]) -> list[Transfer]:
    """
    One transfer per pair of consecutive transit legs, including any walk
    between them. Staying aboard a train that continues as another trip
    (interlining) is not a transfer.
    """
    transfers: list[Transfer] = []
    previous: int | None = None
    for i, leg in enumerate(legs):
        if not isinstance(leg, TransitLeg):
            continue
        if previous is not None and not interlined[i]:
            arriving = legs[previous]
            assert isinstance(arriving, TransitLeg)
            transfers.append(
                Transfer(
                    fromLeg=previous,
                    toLeg=i,
                    station=arriving.toStop.name,
                    transferMinutes=_minutes(
                        leg.scheduledDeparture - arriving.scheduledArrival
                    ),
                    expectedTransferMinutes=_minutes(
                        leg.expectedDeparture - arriving.expectedArrival
                    ),
                )
            )
        previous = i
    return transfers


def _itinerary(raw: dict[str, Any], live_index: dict[str, Any]) -> Itinerary | None:
    legs: list[JourneyLeg] = []
    interlined: list[bool] = []
    for leg in raw.get("legs") or []:
        if leg.get("trip"):
            legs.append(_transit_leg(leg, live_index))
        else:
            legs.append(_walk_leg(leg))
        interlined.append(bool(leg.get("interlineWithPreviousLeg")))

    rides = [leg for leg in legs if isinstance(leg, TransitLeg)]
    if not rides:
        return None
    first, last = rides[0], rides[-1]
    transfers = _transfers(legs, interlined)
    # The journey runs from the start of its first leg to the end of its last,
    # including any walk to the first train or from the last one
    start, end = _times(legs[0]), _times(legs[-1])

    return Itinerary(
        scheduledDeparture=start[0],
        expectedDeparture=start[1],
        scheduledArrival=end[2],
        expectedArrival=end[3],
        durationMinutes=_minutes(end[2] - start[0]),
        transferCount=len(transfers),
        legs=legs,
        transfers=transfers,
        ticketUrl=ticket_url(
            first.fromStop.id, last.toStop.id, first.scheduledDeparture
        ),
    )


def _times(leg: JourneyLeg) -> tuple[int, int, int, int]:
    """Scheduled and expected departure, then scheduled and expected arrival."""
    if isinstance(leg, WalkLeg):
        return (leg.departureTime, leg.departureTime, leg.arrivalTime, leg.arrivalTime)
    return (
        leg.scheduledDeparture,
        leg.expectedDeparture,
        leg.scheduledArrival,
        leg.expectedArrival,
    )


def _rides(itinerary: Itinerary) -> list[TransitLeg]:
    return [leg for leg in itinerary.legs if isinstance(leg, TransitLeg)]


def merge_duplicate_itineraries(itineraries: list[Itinerary]) -> list[Itinerary]:
    """
    OTP lists one physical train as several trips (e.g. "79 ... InterCity" and
    "79 ... gyorsvonat", or the portions "606" and "638" of a split train), and
    returns an itinerary for every combination, sometimes twice. As on the
    station boards, keep one per schedule, preferring trains live on our map (with
    a live delay, then without), then running ones, then realtime data.
    """

    def key(itinerary: Itinerary) -> tuple[tuple[str, int, str, int], ...]:
        return tuple(
            (
                leg.fromStop.id or leg.fromStop.name,
                leg.scheduledDeparture,
                leg.toStop.id or leg.toStop.name,
                leg.scheduledArrival,
            )
            for leg in _rides(itinerary)
        )

    def rank(itinerary: Itinerary) -> tuple[int, int, bool, int]:
        rides = _rides(itinerary)
        return (
            sum(leg.delaySource == "gps" for leg in rides),
            sum(leg.vehicleId is not None for leg in rides),
            not any(leg.canceled for leg in rides),
            sum(leg.realtime for leg in rides),
        )

    return keep_best(itineraries, key=key, rank=rank)


def select_itineraries(
    itineraries: list[Itinerary], arrive_by: bool, limit: int
) -> list[Itinerary]:
    """The first `limit` departures, or the last `limit` arrivals if arriving by."""
    if arrive_by:
        itineraries = sorted(
            itineraries,
            key=lambda i: (i.scheduledArrival, i.scheduledDeparture),
            reverse=True,
        )[:limit]
    itineraries = sorted(
        itineraries, key=lambda i: (i.scheduledDeparture, i.scheduledArrival)
    )
    return itineraries[:limit]


def plan_time(when: datetime | None) -> datetime:
    """The requested time in Budapest, to the minute; naive times are local."""
    if when is None:
        when = datetime.now(BUDAPEST_TZ)
    elif when.tzinfo is None:
        when = when.replace(tzinfo=BUDAPEST_TZ)
    return when.astimezone(BUDAPEST_TZ).replace(second=0, microsecond=0)


async def fetch_journeys(
    redis: Redis,
    session: AsyncSession,
    from_station: Station,
    to_station: Station,
    when: datetime,
    arrive_by: bool,
    limit: int,
) -> JourneyPlan:
    data = await query_graphql(
        JOURNEYS_QUERY,
        {
            "from": f"{RAIL_FEED}:{from_station.id}",
            "to": f"{RAIL_FEED}:{to_station.id}",
            "date": when.strftime("%Y-%m-%d"),
            "time": when.strftime("%H:%M"),
            "arriveBy": arrive_by,
            "n": limit * OVERFETCH,
        },
    )
    raw_itineraries = (data.get("plan") or {}).get("itineraries") or []

    live_index = await load_live_trip_index(redis)
    itineraries = [
        itinerary
        for raw in raw_itineraries
        if (itinerary := _itinerary(raw, live_index)) is not None
    ]
    itineraries = select_itineraries(
        merge_duplicate_itineraries(itineraries), arrive_by, limit
    )
    window = history_window(HISTORY_DAYS)
    await assess_transfers(
        redis, session, itineraries, time.time(), (window.start, window.end)
    )

    return JourneyPlan(
        fromStation=from_station,
        toStation=to_station,
        time=int(when.timestamp()),
        arriveBy=arrive_by,
        generatedAt=int(time.time()),
        itineraries=itineraries,
    )


async def get_journeys(
    redis: Redis,
    session: AsyncSession,
    from_id: str,
    to_id: str,
    when: datetime | None,
    arrive_by: bool,
    limit: int,
) -> JourneyPlan:
    """Journeys between two stations given by UIC code, cached briefly."""
    if from_id == to_id:
        raise SameStationError(from_id)

    stations = {s.id: s for s in await load_station_index(redis)}
    from_station, to_station = stations.get(from_id), stations.get(to_id)
    if from_station is None or to_station is None:
        raise UnknownStationError(from_id if from_station is None else to_id)

    origin, destination = from_station.to_schema(), to_station.to_schema()
    when = plan_time(when)
    key = f"journeys:{from_id}:{to_id}:{when.isoformat()}:{arrive_by}:{limit}"
    return await cached_model(
        redis,
        key,
        JourneyPlan,
        JOURNEYS_TTL,
        lambda: fetch_journeys(
            redis, session, origin, destination, when, arrive_by, limit
        ),
    )
