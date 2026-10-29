import asyncio
import json
import time
from datetime import UTC, datetime
from typing import Any

import httpx
from redis.asyncio import Redis

from api.core.config import settings
from api.core.graphql import post_graphql
from api.core.logging_config import get_logger
from api.core.queries import POSITIONS_QUERY
from api.core.redis import add_key
from api.forecast.serve import annotate_with_latest_model
from api.schemas.alerts import DelayReason
from api.util.county import get_county_for_point
from api.util.preprocess import get_delay_and_position
from api.util.replay import next_snapshot
from api.util.route import route_from_polyline, simplified_polyline
from api.util.trip import seconds_outside_window
from api.util.vehicle import activity, is_stale, should_remove

logger = get_logger(__name__)

# Upper bound for predictions (including a model reload) in a refresh
FORECAST_TIMEOUT_S = 15


class TrainService:
    def __init__(self, redis: Redis):
        self.redis = redis
        # Unix time the vehicle data refers to. None means "now"; replay mode
        # sets it to the snapshot time so recorded data does not look stale.
        self.reference_time: float | None = None

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
        Fetches data from the GraphQL endpoint (see api.core.graphql for the proxy).
        In replay mode (REPLAY_FILE set) the next recorded snapshot is served.
        """
        if settings.REPLAY_FILE:
            snapshot = await next_snapshot(self.redis, settings.REPLAY_FILE)
            self.reference_time = snapshot.get("fetched_at_unix")
            return {"data": {"vehiclePositions": snapshot.get("vehicles") or []}}

        try:
            return await post_graphql(POSITIONS_QUERY, timeout=30.0)
        except httpx.HTTPError as e:
            logger.error(f"HTTP Error: {e}")
            raise e

    def dedupe_by_vehicle_id(
        self, locations: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """
        Deduplicate results by vehicleId. A vehicle is often listed on its
        current and its next trip(s) with the same lastUpdated, so prefer the
        trip whose scheduled window is closest to (ideally contains) the
        position time, then the most recently updated entry.
        """

        def rank(loc: dict[str, Any]) -> tuple[float, int]:
            last_updated = loc.get("lastUpdated", 0)
            outside = seconds_outside_window(loc.get("trip") or {}, last_updated)
            return -outside, last_updated

        best_by_id: dict[str, dict[str, Any]] = {}
        for loc in locations:
            vehicle_id = loc.get("vehicleId")
            if not vehicle_id:
                continue

            existing = best_by_id.get(vehicle_id)
            if not existing or rank(loc) > rank(existing):
                best_by_id[vehicle_id] = loc

        return list(best_by_id.values())

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
        now = self.reference_time or time.time()
        locations_processed = []
        for location in locations:
            trip = location.get("trip", {})
            trip_geometry = trip.get("tripGeometry", {})
            points = trip_geometry.get("points", "")

            route = route_from_polyline(points)

            last_updated_dt = datetime.fromtimestamp(
                location.get("lastUpdated", 0), tz=UTC
            )

            lat: float = location.get("lat", 0.0)
            lon: float = location.get("lon", 0.0)

            delay_data = get_delay_and_position(
                last_updated_dt,
                trip.get("serviceDate"),
                trip.get("stoptimes", []),
                route,
                lat,
                lon,
                location.get("heading"),
                location.get("speed"),
            )

            processed_location = location.copy()
            processed_location.update(
                {
                    "delay": round(delay_data["delay"] / 60),
                    # Unrounded GPS delay, used for history (not in the schema)
                    "delaySeconds": round(delay_data["delay"]),
                    "offRouteMeters": delay_data["offRouteMeters"],
                    "trainPosition": delay_data["trainPosition"],
                    "totalRouteDistance": delay_data["totalRouteDistance"],
                    "processedStops": delay_data["processedStops"],
                    "vehicleProgress": delay_data["vehicleProgress"],
                    # Stop it stands at, if any (not in the schema)
                    "dwellStopIndex": delay_data["dwellStopIndex"],
                    "routeLengthKm": route.length_km,
                }
            )
            processed_location["activity"] = activity(processed_location, now)

            if not should_remove(processed_location, now):
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
            source = "replay" if settings.REPLAY_FILE else "GraphQL endpoint"

            logger.info(
                f"Data fetched from {source} | "
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

        # Best effort: a forecast failure must never break the refresh
        try:
            await asyncio.wait_for(
                annotate_with_latest_model(locations_processed),
                timeout=FORECAST_TIMEOUT_S,
            )
        except Exception as e:
            logger.error(f"Forecast failed, serving without predictions: {e!r}")

        step_start = time.time()

        # Staleness is judged at the snapshot time in replay, else now
        judged_at = self.reference_time or time.time()
        features = []
        for loc in locations_processed:
            if "vehicleId" not in loc:
                continue

            trip = loc.get("trip", {})
            stoptimes = trip.get("stoptimes") or []
            points = (trip.get("tripGeometry") or {}).get("points")
            headsign = (
                (stoptimes[-1].get("stop") or {}).get("name") if stoptimes else None
            )

            distance_to_next_stop_km: float | None = None
            next_stop_id = loc.get("vehicleProgress", {}).get("nextStop")
            processed_stops = loc.get("processedStops", [])
            train_position = loc.get("trainPosition", 0.0)
            total_route_distance = loc.get("totalRouteDistance", 0.0)
            route_length_km = loc.get("routeLengthKm", 0.0)

            if (
                next_stop_id
                and processed_stops
                and total_route_distance > 0
                and route_length_km > 0
            ):
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

            reason = DelayReason.from_texts(
                *(a.get("alertDescriptionText") for a in trip.get("alerts") or [])
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
                    "lastUpdated": int(loc.get("lastUpdated") or 0),
                    # Kept for older clients: stale or not running
                    "isStale": is_stale(loc, judged_at)
                    or loc.get("activity", "running") != "running",
                    "activity": loc.get("activity"),
                    "tripShortName": trip.get("tripShortName", ""),
                    "routeShortName": trip.get("route", {}).get("shortName", ""),
                    "routeTextColor": trip.get("route", {}).get("textColor", ""),
                    "headsign": headsign,
                    "delay": loc.get("delay"),
                    "routePolyline": simplified_polyline(points) if points else None,
                    "distanceToNextStop": distance_to_next_stop_km,
                    "reason": reason.model_dump() if reason else None,
                },
            }
            features.append(feature)

        feature_collection = {
            "type": "FeatureCollection",
            "timestamp": now,
            "noDataReceived": False,
            "features": features,
        }

        # Details and the feed are swapped in one transaction: a train's
        # details never go missing mid-refresh, and never come from another
        # refresh than its marker
        hash_key = add_key("train-positions-hash")
        mapping = {
            loc["vehicleId"]: json.dumps(loc)
            for loc in locations_processed
            if "vehicleId" in loc
        }
        async with self.redis.pipeline(transaction=True) as pipe:
            pipe.delete(hash_key)
            if mapping:
                pipe.hset(hash_key, mapping=mapping)
                pipe.expire(hash_key, settings.CACHE_DURATION)
            pipe.set(
                add_key("train-positions-geojson"),
                json.dumps(feature_collection),
                ex=settings.CACHE_DURATION,
            )
            await pipe.execute()

        logger.info(f"Cache updated (Time: {(time.time() - step_start):.4f}s)")

        logger.info(f"Total revalidation time: {(time.time() - start_time):.4f}s")
