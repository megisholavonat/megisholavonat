"""Response caching in Redis"""

from collections.abc import Awaitable, Callable

from pydantic import BaseModel
from redis.asyncio import Redis

from api.core.logging_config import get_logger
from api.core.redis import add_key

logger = get_logger(__name__)


async def cached_model[M: BaseModel](
    redis: Redis,
    key: str,
    model: type[M],
    ttl_s: int | Callable[[M], int],
    build: Callable[[], Awaitable[M]],
) -> M:
    """
    Return the model cached under `key` (prefixed via add_key), or build it and
    cache it for `ttl_s` seconds (or as long as `ttl_s(value)` says). Redis
    errors fall through to `build`.
    """
    value = await cached_optional_model(redis, key, model, ttl_s, build)
    assert value is not None
    return value


async def cached_optional_model[M: BaseModel](
    redis: Redis,
    key: str,
    model: type[M],
    ttl_s: int | Callable[[M], int],
    build: Callable[[], Awaitable[M | None]],
) -> M | None:
    """`cached_model` for a build that may find nothing; None is not cached."""
    full_key = add_key(key)
    try:
        raw = await redis.get(full_key)
    except Exception as e:
        logger.warning(f"Cache read failed for {full_key}: {e}")
        raw = None
    if raw:
        return model.model_validate_json(raw)

    value = await build()
    if value is None:
        return None
    ttl = ttl_s(value) if callable(ttl_s) else ttl_s
    try:
        await redis.set(full_key, value.model_dump_json(), ex=ttl)
    except Exception as e:
        logger.warning(f"Cache write failed for {full_key}: {e}")
    return value
