"""Delay history endpoints: typical delays"""

from typing import Annotated

from fastapi import APIRouter, Path, Query

from api.core.cache import cached_model
from api.core.db import SessionDep
from api.core.redis import RedisDep
from api.schemas.insights import TrainHistory, TrainStationHistory
from api.services import insights

router = APIRouter(prefix="/history", tags=["history"])

CACHE_TTL_S = 10 * 60

DaysQuery = Annotated[
    int, Query(ge=1, le=365, description="Number of service dates to look back")
]
TrainNumberPath = Annotated[
    str, Path(alias="trainNumber", description="e.g. 10 for 10 TRANSCARPATHIA")
]
StationIdPath = Annotated[
    str, Path(alias="stationId", description="UIC station code, e.g. 005501024")
]


@router.get("/trains/{trainNumber}/stations/{stationId}")
async def get_train_station_history(
    train_number: TrainNumberPath,
    station_id: StationIdPath,
    session: SessionDep,
    redis: RedisDep,
    days: DaysQuery = 28,
) -> TrainStationHistory:
    """How late a train usually is at a station ("usually late by X")"""
    return await cached_model(
        redis,
        f"history:train-station:{train_number}:{station_id}:{days}",
        TrainStationHistory,
        CACHE_TTL_S,
        lambda: insights.train_station_history(session, train_number, station_id, days),
    )


@router.get("/trains/{trainNumber}")
async def get_train_history(
    train_number: TrainNumberPath,
    session: SessionDep,
    redis: RedisDep,
    days: DaysQuery = 28,
) -> TrainHistory:
    """Typical delay at each station of a train's usual route"""
    return await cached_model(
        redis,
        f"history:train:{train_number}:{days}",
        TrainHistory,
        CACHE_TTL_S,
        lambda: insights.train_history(session, train_number, days),
    )
