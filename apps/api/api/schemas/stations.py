from typing import Literal

from pydantic import BaseModel

from api.schemas.alerts import DelayReason

BoardKind = Literal["departures", "arrivals"]
DelaySource = Literal["gps", "otp"]


class Station(BaseModel):
    """A rail station, grouping all of its platforms"""

    id: str  # UIC station code, e.g. "005501024"
    name: str
    lat: float
    lon: float


class BoardEntry(BaseModel):
    """One train on a station's departure or arrival board"""

    tripId: str  # OTP trip gtfsId; train numbers are not unique within a day
    tripShortName: str
    routeShortName: str
    routeTextColor: str | None = None
    # Destination on departure boards, origin on arrival boards
    headsign: str | None = None
    serviceDate: str
    # Unix seconds
    scheduledTime: int
    expectedTime: int
    delayMinutes: int
    delaySource: DelaySource
    platform: str | None = None
    realtime: bool
    canceled: bool = False
    # Set when the train is live on our map
    vehicleId: str | None = None
    # First known delay reason among the trip's alerts
    reason: DelayReason | None = None


class StationBoard(BaseModel):
    """Departure or arrival board of a station, merged across platforms"""

    station: Station
    kind: BoardKind
    generatedAt: int
    entries: list[BoardEntry]
