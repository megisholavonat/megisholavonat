from typing import Any

from pydantic import BaseModel


class StopWithCounty(BaseModel):
    """Stop information with county data"""

    name: str
    lat: float
    lon: float
    platformCode: str | None = None
    county: str | None = None


class StopTimeWithCounty(BaseModel):
    """Stop time information with county data"""

    scheduledArrival: int
    realtimeArrival: int
    scheduledDeparture: int
    realtimeDeparture: int
    stop: StopWithCounty


class Route(BaseModel):
    """Route information"""

    textColor: str
    shortName: str
    longName: str


class TripGeometry(BaseModel):
    """Trip geometry polyline"""

    points: str


class InfoService(BaseModel):
    """Information service details"""

    name: str
    fromStopIndex: int
    tillStopIndex: int
    fontCharSet: str
    fontCode: int
    displayable: bool


class Alert(BaseModel):
    """Alert information"""

    alertDescriptionText: str
    alertUrl: str | None = None
    effectiveStartDate: int
    effectiveEndDate: int


class Trip(BaseModel):
    """Trip information"""

    serviceDate: str
    tripShortName: str
    route: Route
    tripGeometry: TripGeometry
    stoptimes: list[StopTimeWithCounty]
    wheelchairAccessible: str
    bikesAllowed: str
    infoServices: list[InfoService]
    alerts: list[Alert]


class ProcessedStop(BaseModel):
    """Processed stop with distance information"""

    id: str
    originalCoords: list[float]
    distanceAlongRoute: float
    stopTimeInfo: StopTimeWithCounty | None = None


class VehicleProgress(BaseModel):
    """Vehicle progress between stops"""

    lastStop: str
    nextStop: str
    progress: float


class VehiclePositionWithDelay(BaseModel):
    """Complete vehicle position with delay and processing data"""

    vehicleId: str
    lat: float
    lon: float
    heading: float
    speed: float
    lastUpdated: int
    trip: Trip
    delay: int
    trainPosition: float
    totalRouteDistance: float
    processedStops: list[ProcessedStop]
    vehicleProgress: VehicleProgress


class APIResponse(BaseModel):
    """Main API response"""

    timestamp: str
    noDataReceived: bool | None = False
    dataAgeMinutes: int | None = None
    locations: list[VehiclePositionWithDelay]
    error: str | None = None


class TrainFeatureProperties(BaseModel):
    """Properties for a train feature (lighter version)"""

    vehicleId: str
    lat: float
    lon: float
    heading: float
    lastUpdated: str
    tripShortName: str
    delay: int


class TrainFeature(BaseModel):
    """GeoJSON Feature for a train"""

    type: str = "Feature"
    geometry: dict[str, Any]
    properties: TrainFeatureProperties


class TrainFeatureCollection(BaseModel):
    """GeoJSON FeatureCollection for trains"""

    type: str = "FeatureCollection"
    timestamp: str
    noDataReceived: bool | None = False
    dataAgeMinutes: int | None = None
    features: list[TrainFeature]
