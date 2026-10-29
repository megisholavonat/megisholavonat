from api.core.db import SessionTaskiqDep
from api.core.logging_config import get_logger
from api.core.redis import RedisTaskiqDep
from api.core.taskiq_broker import broker
from api.services.map_layers import LAYERS, build_layer

logger = get_logger(__name__)


# After the history rollup (03:30), so the station ranking includes yesterday
@broker.task(schedule=[{"cron": "45 3 * * *", "cron_offset": "Europe/Budapest"}])
async def refresh_map_layers(
    redis: RedisTaskiqDep, session: SessionTaskiqDep
) -> list[str]:
    """Rebuild every map layer; one failing keeps the others fresh."""
    failed: list[str] = []
    for name in LAYERS:
        try:
            await build_layer(redis, session, name)
        except Exception:
            logger.exception(f"Map layer {name} failed to build")
            failed.append(name)
    return failed
