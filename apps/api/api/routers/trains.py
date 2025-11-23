"""Trains API endpoints"""

import json
import time
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException

from api.core.config import settings
from api.core.logging_config import get_logger
from api.core.redis import RedisDep, add_key
from api.schemas.trains import APIResponse

logger = get_logger(__name__)

router = APIRouter(prefix="/trains", tags=["trains"])


@router.get("")
async def get_trains(
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

        if not cached_data:
            logger.info("No cached data, returning empty response")
            return APIResponse(
                timestamp=datetime.now(UTC).isoformat(),
                noDataReceived=True,
                dataAgeMinutes=0,
                locations=[],
            )

        # If data is too old (>15 minutes), do not send it
        if data_age_ms > settings.MAX_STALE_DATA_AGE:
            logger.info("Data stale (>MAX), no data will be served")
            return APIResponse(
                timestamp=datetime.fromtimestamp(
                    cached_data["timestamp"] / 1000, tz=UTC
                ).isoformat(),
                noDataReceived=True,
                dataAgeMinutes=data_age_minutes,
                locations=[],
            )

        # Serve cached data if available
        logger.info(f"Serving cached data (Time: {(time.time() - req_start):.4f}s)")
        return APIResponse(
            timestamp=datetime.fromtimestamp(
                cached_data["timestamp"] / 1000, tz=UTC
            ).isoformat(),
            noDataReceived=cached_data.get("noDataReceived", False),
            dataAgeMinutes=data_age_minutes,
            locations=cached_data["locations"],
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
