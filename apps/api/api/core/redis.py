"""Database connections and configuration"""

from collections.abc import AsyncGenerator
from typing import Annotated

import redis.asyncio as redis
from fastapi import Depends

from api.core.config import settings

# Create a connection pool
redis_pool = redis.ConnectionPool(
    host=settings.REDIS_HOST, port=6379, db=0, decode_responses=True, socket_timeout=5
)


async def get_redis() -> AsyncGenerator[redis.Redis]:
    """
    Dependency that provides a Redis client.
    Uses a connection pool to manage connections efficiently.
    """
    client = redis.Redis(connection_pool=redis_pool)
    try:
        yield client
    finally:
        await client.close()


def add_key(key: str) -> str:
    """Add prefix to Redis key"""
    return f"{key}:"


RedisDep = Annotated[redis.Redis, Depends(get_redis)]
