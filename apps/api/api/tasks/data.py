from api.core.redis import RedisTaskiqDep
from api.core.taskiq_broker import broker
from api.services.train_service import TrainService


@broker.task(schedule=[{"cron": "*/1 * * * *"}])
async def refresh_data(redis: RedisTaskiqDep) -> None:
    train_service = TrainService(redis)
    await train_service.refresh_data()
