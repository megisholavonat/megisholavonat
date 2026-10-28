"""Device lifecycle: erasure and housekeeping"""

import uuid
from collections.abc import Iterable
from datetime import UTC, date, datetime, timedelta
from typing import Any

from redis.asyncio import Redis
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.core.logging_config import get_logger
from api.core.redis import add_key
from api.models.devices import Device, Follow

logger = get_logger(__name__)

# One-off trip follows are kept this many days after their service date
TRIP_FOLLOW_KEEP_DAYS = 2


def device_key(device_id: uuid.UUID, suffix: str) -> str:
    """
    Redis key holding per-device data. Every per-device key must be built with
    this, so erasure can find them all.
    """
    return add_key(f"device:{device_id}:{suffix}")


async def delete_device_keys(redis: Redis, device_ids: Iterable[uuid.UUID]) -> int:
    deleted = 0
    for device_id in device_ids:
        keys = [k async for k in redis.scan_iter(match=device_key(device_id, "*"))]
        if keys:
            deleted += int(await redis.delete(*keys))
    return deleted


async def erase_device(
    session: AsyncSession, redis: Redis, device_id: uuid.UUID
) -> None:
    """Delete a device and everything about it (GDPR erasure). Commits."""
    # Follows and their notification state go with it (ON DELETE CASCADE)
    await session.execute(delete(Device).where(Device.id == device_id))
    await session.commit()
    await delete_device_keys(redis, [device_id])


async def run_housekeeping(
    session: AsyncSession,
    redis: Redis,
    today: date,
    now: datetime | None = None,
) -> dict[str, Any]:
    """
    Delete trip follows 2 days after their service date and devices idle for
    DEVICE_IDLE_DAYS. `today` is the local (Budapest) date. Commits.
    """
    now = now or datetime.now(UTC)
    trip_follows = await session.execute(
        delete(Follow)
        .where(
            Follow.kind == "trip",
            Follow.service_date <= today - timedelta(days=TRIP_FOLLOW_KEEP_DAYS),
        )
        .returning(Follow.id)
    )
    expired_follows = len(trip_follows.all())

    idle = await session.execute(
        delete(Device)
        .where(Device.last_seen_at < now - timedelta(days=settings.DEVICE_IDLE_DAYS))
        .returning(Device.id)
    )
    idle_devices = [row[0] for row in idle]
    await session.commit()
    await delete_device_keys(redis, idle_devices)

    result = {
        "expiredTripFollows": expired_follows,
        "idleDevices": len(idle_devices),
    }
    logger.info(f"Device housekeeping: {result}")
    return result
