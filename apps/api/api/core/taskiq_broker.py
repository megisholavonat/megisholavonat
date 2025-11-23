from taskiq import TaskiqScheduler
from taskiq.schedule_sources import LabelScheduleSource
from taskiq_redis import RedisAsyncResultBackend, RedisStreamBroker

from api.core.config import settings

broker = RedisStreamBroker(f"redis://{settings.REDIS_HOST}:6379").with_result_backend(
    RedisAsyncResultBackend(
        f"redis://{settings.REDIS_HOST}:6379", result_ex_time=60 * 60 * 24
    )
)

scheduler = TaskiqScheduler(broker=broker, sources=[LabelScheduleSource(broker)])
