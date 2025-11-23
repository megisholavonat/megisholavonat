from api.core.redis import RedisTaskiqDep
from api.core.taskiq_broker import broker
from api.services.train_service import TrainService


@broker.task
async def revalidate_data(
    redis: RedisTaskiqDep = ...,  # type: ignore[assignment]
):
    train_service = TrainService(redis)
    return await train_service.revalidate_cache()
