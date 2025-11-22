import functools
import json
import os
from typing import Any, Optional

from shapely.geometry import Point, shape
from shapely.strtree import STRtree

from api.core.logging_config import get_logger

logger = get_logger(__name__)


class CountyIndex:
    """
    Singleton class that manages county spatial index.
    Loads GeoJSON data lazily on first use and provides fast point-in-polygon queries.

    STRtree (Sort-Tile-Recursive tree) is a spatial index that efficiently narrows down
    which county polygons might contain a given point, avoiding O(n) checks.
    """

    _instance: Optional["CountyIndex"] = None
    _initialized: bool

    def __new__(cls) -> "CountyIndex":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self) -> None:
        if self._initialized:
            return

        self._index: STRtree | None = None
        self._geoms: list[Any] = []
        self._props: list[dict[str, Any]] = []
        self._loaded: bool = False
        self._initialized = True

    def _load(self) -> None:
        """
        Loads counties from GeoJSON and builds a spatial index.
        Called lazily on first query.
        """
        if self._loaded:
            return

        file_path = "data/counties.geojson"
        if not os.path.exists(file_path):
            logger.warning(f"{file_path} not found")
            self._loaded = True
            return

        try:
            with open(file_path, encoding="utf-8") as f:
                data = json.load(f)

            geoms = []
            props = []

            for feature in data.get("features", []):
                geom = shape(feature["geometry"])
                geoms.append(geom)
                props.append(feature.get("properties", {}))

            self._geoms = geoms
            self._props = props
            self._index = STRtree(geoms)
            logger.info(f"Successfully indexed {len(geoms)} counties")

        except Exception as e:
            logger.error(f"Error loading counties: {e}")
        finally:
            self._loaded = True

    def query(self, lat: float, lon: float) -> str | None:
        """
        Find the county name for a given latitude and longitude.
        Returns None if no county contains the point.
        """
        if not self._loaded:
            self._load()

        if self._index is None:
            return None

        point = Point(lon, lat)
        candidate_indices = self._index.query(point)

        # Check exact containment for candidates
        for idx in candidate_indices:
            if self._geoms[idx].contains(point):
                result: str | None = self._props[idx].get("megye")
                return result

        return None


# Create singleton instance
_county_index = CountyIndex()


@functools.lru_cache(maxsize=10000)
def get_county_for_point(lat: float, lon: float) -> str | None:
    """
    Finds the county for a given latitude and longitude using spatial indexing.
    """
    return _county_index.query(lat, lon)
