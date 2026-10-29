from typing import Any, Literal, Self

from pydantic import BaseModel, model_validator

from api.schemas.alerts import DelayReason


class StopWithCounty(BaseModel):
    """Stop information with county data"""

    gtfsId: str | None = None
    stationUicPricingCode: str | None = None
    name: str
    lat: float
    lon: float
    platformCode: str | None = None
    county: str | None = None


class StopTimeWithCounty(BaseModel):
    """Stop time information with county data"""

    stopPosition: int | None = None
    scheduledArrival: int
    realtimeArrival: int
    scheduledDeparture: int
    realtimeDeparture: int
    stop: StopWithCounty


class Route(BaseModel):
    """Route information"""

    mode: str | None = None
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

    # Short label when the alert is a known per-train delay reason. Derived
    # from the text on validation, so cached alerts get it too.
    reason: DelayReason | None = None

    @model_validator(mode="after")
    def _fill_reason(self) -> Self:
        if self.reason is None:
            self.reason = DelayReason.from_texts(self.alertDescriptionText)
        return self


class Trip(BaseModel):
    """Trip information"""

    gtfsId: str | None = None
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
    gtfsId: str | None = None
    index: int | None = None
    originalCoords: list[float]
    distanceAlongRoute: float
    stopTimeInfo: StopTimeWithCounty | None = None
    # Forecast delay in minutes when the train passes this stop (departure,
    # or arrival at the terminus). Only set on upcoming stops of running trains.
    predictedDelay: int | None = None


class VehicleProgress(BaseModel):
    """Vehicle progress between stops"""

    lastStop: str
    nextStop: str
    lastStopIndex: int | None = None
    nextStopIndex: int | None = None
    progress: float


class VehiclePositionWithDelay(BaseModel):
    """Complete vehicle position with delay and processing data"""

    vehicleId: str
    lat: float
    lon: float
    heading: float | None = None
    speed: float | None = None
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

    type: Literal["train", "hev", "tramtrain"]
    vehicleId: str
    lat: float
    lon: float
    heading: float | None = None
    speed: float | None = None
    tripShortName: str
    routeShortName: str
    routeTextColor: str
    delay: int
    routePolyline: str | None = None
    distanceToNextStop: float | None = None
    # Unix seconds of the last position update
    lastUpdated: int
    # No update for 30+ minutes, or not running its trip (off route, waiting at
    # its origin, at its destination). See api.util.vehicle.is_stale_or_inactive.
    # Defaults to False for features cached before the field existed.
    isStale: bool = False
    # First known delay reason among the trip's alerts
    reason: DelayReason | None = None


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
