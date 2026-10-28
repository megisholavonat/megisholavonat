from typing import Any

from api.core.db import SessionTaskiqDep
from api.core.redis import RedisTaskiqDep
from api.core.taskiq_broker import broker
from api.services.push_alerts import Senders, check_receipts
from api.services.push_alerts import evaluate_alerts as run_evaluation
from api.services.push_senders import ApnsLiveActivitySender, ExpoPushSender


def make_senders() -> Senders:
    return Senders(
        expo=ExpoPushSender.from_settings(),
        live_activity=ApnsLiveActivitySender.from_settings(),
    )


@broker.task
async def evaluate_alerts(
    redis: RedisTaskiqDep, session: SessionTaskiqDep
) -> dict[str, Any]:
    """Push alerts for followed trains; enqueued after every refresh."""
    senders = make_senders()
    try:
        stats = await run_evaluation(session, redis, senders)
    finally:
        await senders.expo.aclose()
        await senders.live_activity.aclose()
    return stats.as_dict()


@broker.task(schedule=[{"cron": "*/5 * * * *"}])
async def check_push_receipts(
    redis: RedisTaskiqDep, session: SessionTaskiqDep
) -> dict[str, int]:
    """Drop Expo tokens whose receipts say DeviceNotRegistered; every 5 minutes."""
    expo = ExpoPushSender.from_settings()
    try:
        return await check_receipts(session, redis, expo)
    finally:
        await expo.aclose()
