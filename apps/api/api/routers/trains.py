"""Trains API endpoints"""

import json
import time
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException

from api.core.logging_config import get_logger
from api.core.redis import RedisDep, add_key
from api.schemas.trains import (
    TrainFeatureCollection,
    VehiclePositionWithDelay,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/trains", tags=["trains"])


@router.get("")
async def get_trains(
    redis: RedisDep,
) -> TrainFeatureCollection:
    """Get trains information as GeoJSON FeatureCollection"""
    req_start = time.time()

    try:
        step_start = time.time()
        cached_data_string = await redis.get(add_key("train-positions-geojson"))
        cached_data = json.loads(cached_data_string) if cached_data_string else None
        logger.info(f"Redis get (Time: {(time.time() - step_start):.4f}s)")

        now = int(time.time() * 1000)

        if not cached_data:
            logger.info("No cached data, returning empty response")
            return TrainFeatureCollection(
                timestamp=datetime.now(UTC).isoformat(),
                noDataReceived=True,
                dataAgeMinutes=0,
                features=[],
            )

        # Calculate data age
        data_age_ms = (now - cached_data["timestamp"]) if cached_data else 0
        data_age_minutes = data_age_ms // 60000

        logger.info(f"Serving cached data (Time: {(time.time() - req_start):.4f}s)")
        return TrainFeatureCollection(
            timestamp=datetime.fromtimestamp(
                cached_data["timestamp"] / 1000, tz=UTC
            ).isoformat(),
            noDataReceived=cached_data.get("noDataReceived", False),
            dataAgeMinutes=data_age_minutes,
            features=cached_data["features"],
        )

    except Exception as e:
        logger.error(f"Error fetching trains: {e}")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Failed to fetch train positions",
                "features": [],
                "timestamp": datetime.now(UTC).isoformat(),
            },
        ) from e


@router.get("/{vehicle_id}")
async def get_train_details(
    vehicle_id: str,
    redis: RedisDep,
) -> VehiclePositionWithDelay:
    """Get specific train details"""
    try:
        hash_key = add_key("train-positions-hash")
        data = await redis.hget(hash_key, vehicle_id)

        if not data:
            raise HTTPException(status_code=404, detail="Train not found")

        return VehiclePositionWithDelay(**json.loads(data))

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching train details: {e}")
        raise HTTPException(
            status_code=500, detail="Failed to fetch train details"
        ) from e
