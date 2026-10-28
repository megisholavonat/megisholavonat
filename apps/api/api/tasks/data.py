from api.core.logging_config import get_logger
from api.core.redis import RedisTaskiqDep
from api.core.taskiq_broker import broker
from api.services.train_service import TrainService
from api.tasks.history import record_history
from api.tasks.push import evaluate_alerts

logger = get_logger(__name__)


@broker.task(schedule=[{"cron": "*/1 * * * *"}])
async def refresh_data(redis: RedisTaskiqDep) -> None:
    train_service = TrainService(redis)
    await train_service.refresh_data()

    # Separate tasks, so a history or alert failure can never break the refresh
    for task in (record_history, evaluate_alerts):
        try:
            await task.kiq()  # type: ignore[call-overload]
        except Exception as e:
            logger.error(f"Failed to enqueue {task.task_name}: {e}")
