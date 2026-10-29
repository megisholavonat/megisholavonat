from typing import Any

from api.core.db import SessionTaskiqDep
from api.core.redis import RedisTaskiqDep
from api.core.taskiq_broker import broker
from api.services.devices import run_housekeeping
from api.util.time import today


@broker.task(schedule=[{"cron": "45 3 * * *", "cron_offset": "Europe/Budapest"}])
async def device_housekeeping(
    session: SessionTaskiqDep, redis: RedisTaskiqDep
) -> dict[str, Any]:
    """Drop expired trip follows and idle devices; daily at 03:45 local time."""
    return await run_housekeeping(session, redis, today())
