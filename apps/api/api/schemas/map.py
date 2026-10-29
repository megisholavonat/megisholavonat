"""Base layers of our map style, as GeoJSON FeatureCollections"""

from typing import Literal

from pydantic import BaseModel


class MapLineString(BaseModel):
    type: Literal["LineString"]
    # [lon, lat] pairs
    coordinates: list[list[float]]


class MapNetworkProperties(BaseModel):
    # Trains per day on this section, both directions together
    n: int
    # 1 for the HÉV (Budapest suburban railway), 0 for the railways
    hev: Literal[0, 1]


class MapNetworkFeature(BaseModel):
    type: Literal["Feature"]
    properties: MapNetworkProperties
    geometry: MapLineString


class MapNetwork(BaseModel):
    """The passenger rail network, quietest sections first"""

    type: Literal["FeatureCollection"]
    features: list[MapNetworkFeature]


class MapPoint(BaseModel):
    type: Literal["Point"]
    # [lon, lat]
    coordinates: list[float]


class MapStationProperties(BaseModel):
    id: str  # UIC station code, e.g. "005501024"
    name: str
    # Name without a leading "Budapest-"
    short: str
    # Trains observed per day, averaged over the last two weeks of history
    perDay: float
    # 1 for HÉV stations
    hev: Literal[0, 1]


class MapStationFeature(BaseModel):
    type: Literal["Feature"]
    properties: MapStationProperties
    geometry: MapPoint


class MapStations(BaseModel):
    """Rail stations, busiest first"""

    type: Literal["FeatureCollection"]
    features: list[MapStationFeature]
