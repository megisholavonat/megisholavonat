import json
import math
import time
from datetime import UTC, datetime
from typing import Any

import httpx
import polyline  # type: ignore[import-untyped]
from httpx_socks import AsyncProxyTransport  # type: ignore[import-untyped]
from redis.asyncio import Redis

from api.core.config import settings
from api.core.logging_config import get_logger
from api.core.queries import POSITIONS_QUERY
from api.core.redis import add_key
from api.util.county import get_county_for_point
from api.util.preprocess import get_delay_and_position
from api.util.vehicle import should_remove

logger = get_logger(__name__)


def route_length(route_coords: list[tuple[float, float]]) -> float:
    """
    Returns the total haversine length of the route in km.
    """
    total = 0.0
    for (lat1, lon1), (lat2, lon2) in zip(route_coords[:-1], route_coords[1:]):
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = phi2 - phi1
        dlam = math.radians(lon2 - lon1)
        a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
        total += 2 * 6371.0 * math.asin(min(1.0, math.sqrt(a)))
    return total


class TrainService:
    def __init__(self, redis: Redis):
        self.redis = redis

    @staticmethod
    def get_vehicle_type(location: dict[str, Any]) -> str:
        route_mode = location.get("trip", {}).get("route", {}).get("mode")
        mode_to_type = {
            "RAIL": "train",
            "SUBURBAN_RAILWAY": "hev",
            "TRAMTRAIN": "tramtrain",
        }
        return mode_to_type.get(route_mode, "train")

    async def fetch_graphql_data(self) -> dict[str, Any]:
        """
        Fetches data from the GraphQL endpoint, optionally using a SOCKS5 proxy.
        """
        transport = None

        if settings.SOCKS5_PROXY_ENABLE:
            if not settings.SOCKS5_PROXY_HOST or not settings.SOCKS5_PROXY_PORT:
                raise ValueError("Proxy is enabled but HOST or PORT is not set.")

            proxy_url = "socks5://"
            if settings.SOCKS5_PROXY_USERNAME and settings.SOCKS5_PROXY_PASSWORD:
                username = settings.SOCKS5_PROXY_USERNAME
                password = settings.SOCKS5_PROXY_PASSWORD
                proxy_url += f"{username}:{password}@"

            proxy_url += f"{settings.SOCKS5_PROXY_HOST}:{settings.SOCKS5_PROXY_PORT}"

            transport = AsyncProxyTransport.from_url(proxy_url)

        async with httpx.AsyncClient(transport=transport) as client:
            if not settings.GRAPHQL_ENDPOINT:
                raise ValueError("GRAPHQL_ENDPOINT is not set.")

            try:
                response = await client.post(
                    settings.GRAPHQL_ENDPOINT,
                    json={"query": POSITIONS_QUERY},
                    timeout=30.0,
                )
                response.raise_for_status()
                result: dict[str, Any] = response.json()
                return result
            except httpx.HTTPError as e:
                logger.error(f"HTTP Error: {e}")
                raise e

    def dedupe_by_vehicle_id(
        self, locations: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """
        Deduplicate results by vehicleId, keeping the most recently updated entry.
        """
        latest_by_id: dict[str, dict[str, Any]] = {}
        for loc in locations:
            vehicle_id = loc.get("vehicleId")
            if not vehicle_id:
                continue

            existing = latest_by_id.get(vehicle_id)
            if not existing or loc.get("lastUpdated", 0) > existing.get(
                "lastUpdated", 0
            ):
                latest_by_id[vehicle_id] = loc

        return list(latest_by_id.values())

    def add_counties_to_locations(
        self, locations: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """
        Adds county information to locations.
        """

        def process_stoptime(stoptime: dict[str, Any]) -> dict[str, Any]:
            stop = stoptime.get("stop", {})
            county = get_county_for_point(stop.get("lat"), stop.get("lon"))

            new_stop = stop.copy()
            new_stop["county"] = county

            new_stoptime = stoptime.copy()
            new_stoptime["stop"] = new_stop
            return new_stoptime

        def process_location(location: dict[str, Any]) -> dict[str, Any]:
            trip = location.get("trip", {})
            stoptimes = trip.get("stoptimes", [])

            # Process all stoptimes
            processed_stoptimes = [process_stoptime(st) for st in stoptimes]

            new_trip = trip.copy()
            new_trip["stoptimes"] = processed_stoptimes

            new_location = location.copy()
            new_location["trip"] = new_trip
            return new_location

        # Process all locations
        return [process_location(loc) for loc in locations]

    def process_locations(
        self, locations: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """
        Process delays and filter stale data
        """
        locations_processed = []
        for location in locations:
            trip = location.get("trip", {})
            trip_geometry = trip.get("tripGeometry", {})
            points = trip_geometry.get("points", "")

            route_coords = polyline.decode(points)

            last_updated_dt = datetime.fromtimestamp(
                location.get("lastUpdated", 0), tz=UTC
            )

            lat: float = location.get("lat", 0.0)
            lon: float = location.get("lon", 0.0)

            delay_data = get_delay_and_position(
                last_updated_dt,
                trip.get("serviceDate"),
                trip.get("stoptimes", []),
                route_coords,
                lat,
                lon,
                location.get("heading"),
            )

            processed_location = location.copy()
            processed_location.update(
                {
                    "delay": round(delay_data["delay"] / 60),
                    "trainPosition": delay_data["trainPosition"],
                    "totalRouteDistance": delay_data["totalRouteDistance"],
                    "processedStops": delay_data["processedStops"],
                    "vehicleProgress": delay_data["vehicleProgress"],
                    "routeLengthKm": route_length(route_coords),
                }
            )

            if not should_remove(processed_location):
                locations_processed.append(processed_location)

        return locations_processed

    async def refresh_data(self) -> None:
        """
        Fetches new data, and updates Redis.
        """
        start_time = time.time()
        logger.info("Starting refresh_data...")

        now = int(time.time() * 1000)

        try:
            step_start = time.time()
            data = await self.fetch_graphql_data()
            logger.info(
                f"GraphQL data fetched (Time: {(time.time() - step_start):.4f}s)"
            )

            # Extract locations array
            locations_raw = data.get("data", {}).get("vehiclePositions", [])
            # Fallback if flattened
            if not locations_raw and "vehiclePositions" in data:
                locations_raw = data["vehiclePositions"]

            vehicle_count = len(locations_raw)
            proxy_status = "✅" if settings.SOCKS5_PROXY_ENABLE else "❌"

            logger.info(
                f"Request sent to GraphQL endpoint | "
                f"Proxy: {proxy_status} | Vehicle Count: {vehicle_count}"
            )

        except Exception as e:
            logger.error(f"Failed to fetch train positions: {e}")
            raise e

        step_start = time.time()
        locations = self.dedupe_by_vehicle_id(locations_raw)
        logger.info(
            f"Deduplicated locations: {len(locations_raw)} -> {len(locations)} "
            f"(Time: {(time.time() - step_start):.4f}s)"
        )

        no_data_received = len(locations_raw) == 0

        if no_data_received:
            logger.warning("External endpoint returned no data, keeping existing cache")
            return

        step_start = time.time()
        locations_with_counties = self.add_counties_to_locations(locations)
        logger.info(f"Added counties (Time: {(time.time() - step_start):.4f}s)")

        step_start = time.time()
        locations_processed = self.process_locations(locations_with_counties)

        logger.info(
            f"Processed delays & filtered: {len(locations_with_counties)} -> "
            f"{len(locations_processed)} (Time: {(time.time() - step_start):.4f}s)"
        )

        step_start = time.time()

        hash_key = add_key("train-positions-hash")

        # Clear existing hash first to remove stale vehicles
        await self.redis.delete(hash_key)

        if locations_processed:
            mapping = {
                loc["vehicleId"]: json.dumps(loc)
                for loc in locations_processed
                if "vehicleId" in loc
            }
            if mapping:
                await self.redis.hset(hash_key, mapping=mapping)
                await self.redis.expire(hash_key, settings.CACHE_DURATION)

        features = []
        for loc in locations_processed:
            if "vehicleId" not in loc:
                continue

            trip = loc.get("trip", {})

            distance_to_next_stop_km: float | None = None
            next_stop_id = loc.get("vehicleProgress", {}).get("nextStop")
            processed_stops = loc.get("processedStops", [])
            train_position = loc.get("trainPosition", 0.0)
            total_route_distance = loc.get("totalRouteDistance", 0.0)
            route_length_km = loc.get("routeLengthKm", 0.0)

            if next_stop_id and processed_stops and total_route_distance > 0 and route_length_km > 0:
                next_stop = next(
                    (s for s in processed_stops if s.get("id") == next_stop_id),
                    None,
                )
                if next_stop:
                    shapely_dist = max(
                        0.0, next_stop["distanceAlongRoute"] - train_position
                    )
                    distance_to_next_stop_km = round(
                        shapely_dist / total_route_distance * route_length_km, 4
                    )

            feature = {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [loc.get("lon", 0), loc.get("lat", 0)],
                },
                "properties": {
                    "type": self.get_vehicle_type(loc),
                    "vehicleId": loc["vehicleId"],
                    "lat": loc.get("lat"),
                    "lon": loc.get("lon"),
                    "heading": loc.get("heading"),
                    "speed": loc.get("speed"),
                    "lastUpdated": str(loc.get("lastUpdated")),
                    "tripShortName": trip.get("tripShortName", ""),
                    "routeShortName": trip.get("route", {}).get("shortName", ""),
                    "routeTextColor": trip.get("route", {}).get("textColor", ""),
                    "delay": loc.get("delay"),
                    "routePolyline": trip.get("tripGeometry", {}).get("points"),
                    "distanceToNextStop": distance_to_next_stop_km,
                },
            }
            features.append(feature)

        feature_collection = {
            "type": "FeatureCollection",
            "timestamp": now,
            "noDataReceived": False,
            "features": features,
        }

        await self.redis.set(
            add_key("train-positions-geojson"),
            json.dumps(feature_collection),
            ex=settings.CACHE_DURATION,
        )

        logger.info(f"Cache updated (Time: {(time.time() - step_start):.4f}s)")

        logger.info(f"Total revalidation time: {(time.time() - start_time):.4f}s")
