from typing import Annotated, Literal

from pydantic import BaseModel, Field

from api.schemas.stations import DelaySource, Station


class JourneyStop(BaseModel):
    """Where a leg starts or ends"""

    id: str | None = None  # UIC station code
    name: str
    lat: float
    lon: float
    platform: str | None = None


class WalkLeg(BaseModel):
    """A walk, e.g. between two stations of a town"""

    type: Literal["walk"] = "walk"
    fromStop: JourneyStop
    toStop: JourneyStop
    # Unix seconds
    departureTime: int
    arrivalTime: int
    distanceMeters: int


class TransitLeg(BaseModel):
    """A ride on one train (or rail replacement bus)"""

    type: Literal["transit"] = "transit"
    # RAIL, SUBURBAN_RAILWAY (HÉV), TRAMTRAIN or RAIL_REPLACEMENT_BUS
    mode: str
    tripId: str  # OTP trip gtfsId
    tripShortName: str  # e.g. "7406 BÉKÉS InterCity"
    trainNumber: str  # e.g. "7406"
    routeShortName: str  # MNR2007 pictogram HTML, as on the boards
    routeLongName: str | None = None
    routeTextColor: str | None = None
    headsign: str | None = None
    serviceDate: str
    fromStop: JourneyStop
    toStop: JourneyStop
    # Unix seconds
    scheduledDeparture: int
    expectedDeparture: int
    scheduledArrival: int
    expectedArrival: int
    # Departure delay; GPS-derived whenever the train is live on our map
    delayMinutes: int
    delaySource: DelaySource
    realtime: bool
    canceled: bool = False
    # Stops between boarding and alighting
    intermediateStops: int
    # Set when the train is live on our map
    vehicleId: str | None = None


# How likely a transfer is missed: safe (well under 10%), tight, or likely
# missed (50% or more)
ConnectionRisk = Literal["safe", "tight", "likely_missed"]
# forecast: the live delay forecast of a running train; history: the trains'
# usual delays at the station; canceled: one of the trains is canceled
ConnectionRiskSource = Literal["forecast", "history", "canceled"]


JourneyLeg = Annotated[WalkLeg | TransitLeg, Field(discriminator="type")]


class Transfer(BaseModel):
    """A change between two consecutive trains"""

    # Index of the arriving transit leg in `legs`; the next transit leg departs
    fromLeg: int
    toLeg: int
    station: str  # where the arriving train stops
    transferMinutes: int  # planned
    expectedTransferMinutes: int  # with current delays
    # Probability of missing the connection (allowing a minimum transfer time
    # and any walk); None when neither a forecast nor any history is known
    missRisk: float | None = None
    risk: ConnectionRisk | None = None
    riskSource: ConnectionRiskSource | None = None


class Itinerary(BaseModel):
    """One way to get from A to B"""

    # Unix seconds, from the start of the first leg to the end of the last,
    # walks included
    scheduledDeparture: int
    expectedDeparture: int
    scheduledArrival: int
    expectedArrival: int
    durationMinutes: int  # planned
    transferCount: int
    legs: list[JourneyLeg]
    transfers: list[Transfer]
    # MÁV ticket shop search for this journey (no train-specific parameter)
    ticketUrl: str


class JourneyPlan(BaseModel):
    """Journeys between two rail stations"""

    fromStation: Station
    toStation: Station
    time: int  # requested time, unix seconds
    arriveBy: bool
    generatedAt: int
    itineraries: list[Itinerary]
