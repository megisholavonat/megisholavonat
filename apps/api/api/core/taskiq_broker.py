from taskiq import TaskiqEvents, TaskiqScheduler, TaskiqState
from taskiq.schedule_sources import LabelScheduleSource
from taskiq_redis import RedisAsyncResultBackend, RedisStreamBroker

from api.core.config import settings
from api.core.db import engine

redis_url = f"redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}"

broker = RedisStreamBroker(
    redis_url,
    queue_name=f"{settings.REDIS_KEY}:taskiq",
    consumer_group_name=f"{settings.REDIS_KEY}:taskiq",
).with_result_backend(RedisAsyncResultBackend(redis_url, result_ex_time=60 * 60 * 24))

scheduler = TaskiqScheduler(broker=broker, sources=[LabelScheduleSource(broker)])


@broker.on_event(TaskiqEvents.WORKER_SHUTDOWN)
async def _dispose_db_engine(state: TaskiqState) -> None:
    await engine.dispose()
