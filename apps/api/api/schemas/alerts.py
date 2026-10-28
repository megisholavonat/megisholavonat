from pydantic import BaseModel


class AlertRoute(BaseModel):
    """Route affected by an alert"""

    id: str
    mode: str | None = None
    shortName: str | None = None
    longName: str | None = None


class AlertTrip(BaseModel):
    """Single train affected by an alert"""

    tripId: str
    tripShortName: str | None = None


class AlertStation(BaseModel):
    """Station affected by an alert"""

    id: str  # UIC station code, same as Station.id
    name: str


class RailAlert(BaseModel):
    """An active rail disruption or service notice"""

    id: str
    header: str | None = None
    # May contain HTML; clients must sanitise it before rendering
    description: str
    url: str | None = None
    # Unix seconds
    start: int | None = None
    end: int | None = None
    affectedRoutes: list[AlertRoute]
    affectedTrips: list[AlertTrip]
    affectedStations: list[AlertStation]
