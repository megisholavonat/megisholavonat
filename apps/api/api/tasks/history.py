from datetime import datetime
from typing import Any

import pytz

from api.core.db import SessionTaskiqDep
from api.core.redis import RedisTaskiqDep
from api.core.taskiq_broker import broker
from api.services.history import record_from_cache, run_maintenance

BUDAPEST_TZ = pytz.timezone("Europe/Budapest")


@broker.task
async def record_history(redis: RedisTaskiqDep, session: SessionTaskiqDep) -> int:
    """Record stop passages from the positions the last refresh cached."""
    return await record_from_cache(redis, session)


@broker.task(schedule=[{"cron": "30 3 * * *", "cron_offset": "Europe/Budapest"}])
async def history_maintenance(session: SessionTaskiqDep) -> dict[str, Any]:
    """Partitions, rollup of yesterday and retention; daily at 03:30 local time."""
    today = datetime.now(BUDAPEST_TZ).date()
    return await run_maintenance(session, today)
