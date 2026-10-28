from typing import Any

from api.core.db import SessionTaskiqDep
from api.core.taskiq_broker import broker
from api.forecast.train import train_and_store


@broker.task(schedule=[{"cron": "15 4 * * 1", "cron_offset": "Europe/Budapest"}])
async def train_delay_forecast(session: SessionTaskiqDep) -> dict[str, Any]:
    """Retrain the delay forecast on the last four weeks; Mondays 04:15 local."""
    return await train_and_store(session)
