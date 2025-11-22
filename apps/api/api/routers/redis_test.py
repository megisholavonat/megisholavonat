"""Redis API endpoints"""

from fastapi import APIRouter, HTTPException

from api.core.config import settings
from api.core.redis import RedisDep

router = APIRouter(prefix="/redis", tags=["redis"])


@router.get("")
async def get_redis_status(redis: RedisDep) -> dict[str, str]:
    """Get Redis connection status and test operations"""
    try:
        await redis.ping()  # type: ignore[misc]

        test_key = "test:connection"
        test_value = "test-data"
        await redis.set(test_key, test_value, ex=60)

        info = await redis.info("server")
        redis_version = info.get("redis_version")

        return {
            "status": "success",
            "redis_host": settings.REDIS_HOST,
            "redis_version": redis_version,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Redis error: {e!s}") from e
