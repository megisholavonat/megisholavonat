"""Trains API endpoints"""

import json
import time
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from api.core.config import settings
from api.core.logging_config import get_logger
from api.core.redis import RedisDep, add_key
from api.schemas.trains import APIResponse
from api.services.train_service import TrainService
from api.tasks.data import revalidate_data

logger = get_logger(__name__)

router = APIRouter(prefix="/trains", tags=["trains"])


def get_train_service(redis: RedisDep) -> TrainService:
    return TrainService(redis)


@router.get("")
async def get_trains(
    service: Annotated[TrainService, Depends(get_train_service)],
    redis: RedisDep,
) -> APIResponse:
    """Get trains information"""
    req_start = time.time()

    try:
        step_start = time.time()
        cached_data_string = await redis.get(add_key("train-positions"))
        cached_data = json.loads(cached_data_string) if cached_data_string else None
        logger.info(f"Redis get (Time: {(time.time() - step_start):.4f}s)")

        now = int(time.time() * 1000)

        # Calculate data age
        data_age_ms = (now - cached_data["timestamp"]) if cached_data else 0
        data_age_minutes = data_age_ms // 60000

        # If data is too old (>15 minutes), hide all data
        if cached_data and data_age_ms > settings.MAX_STALE_DATA_AGE:
            logger.info("Data stale (>MAX), triggering bg revalidation")
            await revalidate_data.kiq()
            return APIResponse(
                timestamp=datetime.fromtimestamp(
                    cached_data["timestamp"] / 1000, tz=UTC
                ).isoformat(),
                noDataReceived=True,
                dataAgeMinutes=data_age_minutes,
                locations=[],
            )

        # Serve cached data if available
        if cached_data:
            if data_age_ms > settings.REVALIDATE_DURATION * 1000:
                logger.info("Data stale (>REVALIDATE), triggering bg revalidation")
                await revalidate_data.kiq()

            logger.info(f"Serving cached data (Time: {(time.time() - req_start):.4f}s)")
            return APIResponse(
                timestamp=datetime.fromtimestamp(
                    cached_data["timestamp"] / 1000, tz=UTC
                ).isoformat(),
                noDataReceived=cached_data.get("noDataReceived", False),
                dataAgeMinutes=data_age_minutes,
                locations=cached_data["locations"],
            )

        # No cached data, try to fetch fresh
        logger.info("No cache, fetching fresh data...")
        locations_processed = await service.revalidate_cache()

        # If revalidation failed or returned nothing/skipped
        if locations_processed is None:
            logger.info("Revalidation skipped/failed, checking retry cache")
            # Check cache again
            retry_cache_str = await redis.get(add_key("train-positions"))
            retry_cache = json.loads(retry_cache_str) if retry_cache_str else None

            if retry_cache:
                retry_age_ms = now - retry_cache["timestamp"]
                retry_age_min = retry_age_ms // 60000

                if retry_age_ms > settings.MAX_STALE_DATA_AGE:
                    return APIResponse(
                        timestamp=datetime.fromtimestamp(
                            retry_cache["timestamp"] / 1000, tz=UTC
                        ).isoformat(),
                        noDataReceived=True,
                        dataAgeMinutes=retry_age_min,
                        locations=[],
                    )

                return APIResponse(
                    timestamp=datetime.fromtimestamp(
                        retry_cache["timestamp"] / 1000, tz=UTC
                    ).isoformat(),
                    noDataReceived=False,
                    dataAgeMinutes=retry_age_min,
                    locations=retry_cache["locations"],
                )

            # No data at all
            logger.warning("No data available")
            return APIResponse(
                timestamp=datetime.now(UTC).isoformat(),
                noDataReceived=True,
                locations=[],
            )

        logger.info(f"Request completed (Time: {(time.time() - req_start):.4f}s)")
        return APIResponse(
            timestamp=datetime.fromtimestamp(now / 1000, tz=UTC).isoformat(),
            noDataReceived=False,
            dataAgeMinutes=0,
            locations=locations_processed,
        )

    except Exception as e:
        logger.error(f"Error fetching trains: {e}")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Failed to fetch train positions",
                "locations": [],
                "timestamp": datetime.now(UTC).isoformat(),
            },
        ) from e
