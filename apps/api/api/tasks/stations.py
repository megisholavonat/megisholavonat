from api.core.redis import RedisTaskiqDep
from api.core.taskiq_broker import broker
from api.services.station_index import build_station_index


@broker.task(schedule=[{"cron": "17 3 * * *"}])
async def refresh_station_index(redis: RedisTaskiqDep) -> None:
    await build_station_index(redis)
