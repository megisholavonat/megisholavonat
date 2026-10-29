"""Journey planning between rail stations, on top of OTP's `plan` query.

With city transit, a town's metro, trams and buses take the traveller to the
first train, from the last one, or between two trains at different stations:
Keleti -> Szeged by bus 8E to Zugló, Déli -> Vác by tram to Nyugati,
Miskolc-Gömöri -> Budapest by bus 43 to Tiszai. Every journey still rides at
least one train, and interurban coaches never replace one.
"""

import time
from datetime import datetime
from typing import Any

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.cache import cached_model
from api.core.graphql import query_graphql
from api.core.queries import JOURNEYS_QUERY
from api.schemas.journeys import (
    CityLeg,
    Itinerary,
    JourneyLeg,
    JourneyPlan,
    JourneyStop,
    Transfer,
    TransitLeg,
    WalkLeg,
)
from api.schemas.stations import Station
from api.services import budapest
from api.services.connection_risk import HISTORY_DAYS, assess_transfers
from api.services.insights import history_window
from api.services.live_trips import load_live_trip_index, match_live_trip
from api.services.station_board import keep_best, train_number
from api.services.station_index import RAIL_FEED, load_station_index
from api.util.ticket import ticket_url
from api.util.time import BUDAPEST_TZ

JOURNEYS_TTL = 60  # seconds
# OTP spends several of its itineraries on duplicates of the same trains, and
# with city transit on ways of reaching them
OVERFETCH = 2
CITY_OVERFETCH = 3

RAIL_MODES = ("RAIL", "SUBURBAN_RAILWAY", "TRAMTRAIN", "RAIL_REPLACEMENT_BUS")
CITY_MODES = ("SUBWAY", "TRAM", "BUS", "TROLLEYBUS")
# Upstream feeds of urban (local) transit, by feed id. Any other non-rail feed
# is dropped with the itinerary riding it: the interurban coaches of MÁV-Volán
# ("hkir", one feed for all its regional agencies) and the Balaton ferries
# ("bahart"). Győr's and other towns' local buses run in "hkir" and so are
# left out as well.
URBAN_FEEDS = frozenset(
    {
        "BKK",  # Budapest: metro, tram, trolleybus, bus (and HÉV lines)
        "debrecen",  # DKV: tram, trolleybus, bus
        "mvkzrt",  # Miskolc (MVK): tram, bus
        "szeged",  # Szeged (SZKT tram and trolleybus; MÁV's city buses)
        "pecs",  # Pécs (Tüke Busz)
        "kecskemet",  # Kecskemét
        "kaposvar",  # Kaposvár
        "tatabanya",  # Tatabánya (T-Busz)
        "VBUSZ",  # Veszprém (V-Busz)
        "szombathely",  # Szombathely (Blaguss Agora)
        "paks",  # Paks
    }
)
# City rides allowed to reach the first train, to leave the last one, and
# between two trains at different stations (once per journey)
MAX_CITY_HOPS = 2


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


def _city_leg(leg: dict[str, Any]) -> CityLeg:
    route = leg.get("route") or {}
    expected_departure = leg["startTime"] // 1000
    expected_arrival = leg["endTime"] // 1000
    return CityLeg(
        mode=leg["mode"],
        line=route.get("shortName") or route.get("longName") or "",
        routeColor=route.get("color"),
        routeTextColor=route.get("textColor"),
        headsign=leg.get("headsign"),
        fromStop=_stop(leg["from"]),
        toStop=_stop(leg["to"]),
        scheduledDeparture=expected_departure - (leg.get("departureDelay") or 0),
        expectedDeparture=expected_departure,
        scheduledArrival=expected_arrival - (leg.get("arrivalDelay") or 0),
        expectedArrival=expected_arrival,
        realtime=bool(leg.get("realTime")),
        intermediateStops=len(leg.get("intermediateStops") or []),
    )


def _feed(leg: dict[str, Any]) -> str:
    gtfs_id = (leg.get("route") or {}).get("gtfsId") or leg["trip"]["gtfsId"]
    return str(gtfs_id).partition(":")[0]


def _minutes(seconds: int) -> int:
    return round(seconds / 60)


def _transfers(legs: list[JourneyLeg], interlined: list[bool]) -> list[Transfer]:
    """
    One transfer per pair of consecutive trains, including any walk or city
    ride between them. Staying aboard a train that continues as another trip
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


def _city_hops_allowed(legs: list[JourneyLeg]) -> bool:
    """
    City rides only before the first train, after the last one, and in at
    most one link between two trains; at most MAX_CITY_HOPS in each.
    """
    segments = [0]
    for leg in legs:
        if isinstance(leg, TransitLeg):
            segments.append(0)
        elif isinstance(leg, CityLeg):
            segments[-1] += 1
    links = segments[1:-1]
    return max(segments) <= MAX_CITY_HOPS and sum(1 for n in links if n) <= 1


def _in_budapest(stop: JourneyStop) -> bool:
    return budapest.is_budapest_station(stop.id, stop.lat, stop.lon)


def _itinerary(
    raw: dict[str, Any],
    live_index: dict[str, Any],
    from_any: bool = False,
    to_any: bool = False,
) -> Itinerary | None:
    """
    The itinerary, or None unless it rides a train and keeps to the city
    transit rules. From (to) any Budapest station, the journey starts at its
    first train (ends at its last), which must leave from (arrive at) a
    Budapest station.
    """
    legs: list[JourneyLeg] = []
    interlined: list[bool] = []
    for leg in raw.get("legs") or []:
        if leg.get("trip"):
            feed = _feed(leg)
            if feed == RAIL_FEED:
                legs.append(_transit_leg(leg, live_index))
            elif feed in URBAN_FEEDS:
                legs.append(_city_leg(leg))
            else:
                return None
        else:
            legs.append(_walk_leg(leg))
        interlined.append(bool(leg.get("interlineWithPreviousLeg")))

    trains = [i for i, leg in enumerate(legs) if isinstance(leg, TransitLeg)]
    if not trains:
        return None
    first, last = legs[trains[0]], legs[trains[-1]]
    assert isinstance(first, TransitLeg)
    assert isinstance(last, TransitLeg)
    start, end = 0, len(legs)
    if from_any:
        if not _in_budapest(first.fromStop):
            return None
        start = trains[0]
    if to_any:
        if not _in_budapest(last.toStop):
            return None
        end = trains[-1] + 1
    legs, interlined = legs[start:end], interlined[start:end]
    if not _city_hops_allowed(legs):
        return None

    transfers = _transfers(legs, interlined)
    # The journey runs from the start of its first leg to the end of its last,
    # including any walk or city ride to the first train or from the last one
    begin, finish = _times(legs[0]), _times(legs[-1])

    return Itinerary(
        scheduledDeparture=begin[0],
        expectedDeparture=begin[1],
        scheduledArrival=finish[2],
        expectedArrival=finish[3],
        durationMinutes=_minutes(finish[2] - begin[0]),
        transferCount=len(transfers),
        legs=legs,
        transfers=transfers,
        # The trains only: city rides take a local ticket or pass
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


def _city_hops(itinerary: Itinerary) -> int:
    return sum(isinstance(leg, CityLeg) for leg in itinerary.legs)


def _trains_key(itinerary: Itinerary) -> tuple[tuple[str, int], ...]:
    """Where and when each train is left: the same trains, however boarded."""
    return tuple(
        (leg.toStop.id or leg.toStop.name, leg.scheduledArrival)
        for leg in _rides(itinerary)
    )


def merge_duplicate_itineraries(itineraries: list[Itinerary]) -> list[Itinerary]:
    """
    OTP lists one physical train as several trips (e.g. "79 ... InterCity" and
    "79 ... gyorsvonat", or the portions "606" and "638" of a split train), and
    returns an itinerary for every combination, sometimes twice; with city
    transit also one for every way of reaching the same trains (bus 8E, 133E
    or 5 to Zugló). Itineraries are the same when their trains are left at the
    same stations and times. As on the station boards, keep one per schedule,
    preferring trains live on our map (with a live delay, then without), then
    running ones, then realtime data, then the latest departure, then the
    fewest city rides.

    Then, of itineraries leaving and arriving at the same times that differ
    only in a train in between (Szolnok -> Eger changing at Hatvan or at
    Füzesabony onto one train listed under two numbers), keep the one with
    the fewest changes, then city rides, then the longest shortest change.
    """

    def rank(itinerary: Itinerary) -> tuple[int, int, bool, int, int, int]:
        rides = _rides(itinerary)
        return (
            sum(leg.delaySource == "gps" for leg in rides),
            sum(leg.vehicleId is not None for leg in rides),
            not any(leg.canceled for leg in rides),
            sum(leg.realtime for leg in rides),
            itinerary.scheduledDeparture,
            -_city_hops(itinerary),
        )

    def same_times_rank(itinerary: Itinerary) -> tuple[bool, int, int, int]:
        return (
            not any(leg.canceled for leg in _rides(itinerary)),
            -itinerary.transferCount,
            -_city_hops(itinerary),
            min((t.transferMinutes for t in itinerary.transfers), default=0),
        )

    merged = keep_best(itineraries, key=_trains_key, rank=rank)
    return keep_best(
        merged,
        key=lambda i: (i.scheduledDeparture, i.scheduledArrival),
        rank=same_times_rank,
    )


def drop_detours_within_budapest(
    itineraries: list[Itinerary], from_any: bool, to_any: bool
) -> list[Itinerary]:
    """
    From (to) any Budapest station, a train to another Budapest station only
    to change onto the same trains is a detour (Déli -> Kelenföld for the
    railjet that starts at Kelenföld). It is dropped when the rest of the
    journey is on the list by itself.
    """
    if not from_any and not to_any:
        return itineraries
    keys = {_trains_key(i) for i in itineraries}

    def detour(itinerary: Itinerary) -> bool:
        trains = _trains_key(itinerary)
        rides = _rides(itinerary)
        for cut in range(1, len(rides)):
            if (
                from_any
                and all(_in_budapest(leg.toStop) for leg in rides[:cut])
                and trains[cut:] in keys
            ):
                return True
            if (
                to_any
                and all(_in_budapest(leg.fromStop) for leg in rides[cut:])
                and trains[:cut] in keys
            ):
                return True
        return False

    return [i for i in itineraries if not detour(i)]


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


def _place(station: Station) -> str:
    """OTP's `fromPlace`/`toPlace`: a rail station, or Budapest's centre."""
    if station.id == budapest.BUDAPEST_ID:
        return f"Budapest::{station.lat},{station.lon}"
    return f"{RAIL_FEED}:{station.id}"


async def fetch_journeys(
    redis: Redis,
    session: AsyncSession,
    from_station: Station,
    to_station: Station,
    when: datetime,
    arrive_by: bool,
    limit: int,
    city_transit: bool = False,
) -> JourneyPlan:
    from_any = from_station.id == budapest.BUDAPEST_ID
    to_any = to_station.id == budapest.BUDAPEST_ID
    modes = [*RAIL_MODES, *CITY_MODES] if city_transit else [*RAIL_MODES]
    data = await query_graphql(
        JOURNEYS_QUERY,
        {
            "from": _place(from_station),
            "to": _place(to_station),
            "date": when.strftime("%Y-%m-%d"),
            "time": when.strftime("%H:%M"),
            "arriveBy": arrive_by,
            "n": limit * (CITY_OVERFETCH if city_transit else OVERFETCH),
            "modes": [{"mode": mode} for mode in [*modes, "WALK"]],
        },
    )
    raw_itineraries = (data.get("plan") or {}).get("itineraries") or []

    live_index = await load_live_trip_index(redis)
    itineraries = [
        itinerary
        for raw in raw_itineraries
        if (itinerary := _itinerary(raw, live_index, from_any, to_any)) is not None
    ]
    itineraries = merge_duplicate_itineraries(itineraries)
    itineraries = drop_detours_within_budapest(itineraries, from_any, to_any)
    itineraries = select_itineraries(itineraries, arrive_by, limit)
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
    city_transit: bool = False,
) -> JourneyPlan:
    """
    Journeys between two stations given by UIC code, or "budapest" for any
    Budapest station, cached briefly. City transit is always on for
    "budapest".
    """
    if from_id == to_id:
        raise SameStationError(from_id)

    stations = {s.id: s.to_schema() for s in await load_station_index(redis)}
    stations[budapest.BUDAPEST_ID] = budapest.budapest_station()
    origin, destination = stations.get(from_id), stations.get(to_id)
    if origin is None or destination is None:
        raise UnknownStationError(from_id if origin is None else to_id)
    # "Budapest" to one of its own stations
    for any_, other in ((origin, destination), (destination, origin)):
        if any_.id == budapest.BUDAPEST_ID and other.id in budapest.STATIONS:
            raise SameStationError(other.id)
    city_transit = city_transit or budapest.BUDAPEST_ID in (from_id, to_id)

    when = plan_time(when)
    mode = "city" if city_transit else "rail"
    key = f"journeys:{from_id}:{to_id}:{when.isoformat()}:{arrive_by}:{limit}:{mode}"
    return await cached_model(
        redis,
        key,
        JourneyPlan,
        JOURNEYS_TTL,
        lambda: fetch_journeys(
            redis,
            session,
            origin,
            destination,
            when,
            arrive_by,
            limit,
            city_transit,
        ),
    )
