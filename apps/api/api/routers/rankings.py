"""Punctuality ranking endpoints"""

from typing import Annotated

from fastapi import APIRouter, Query

from api.core.cache import cached_model
from api.core.db import SessionDep
from api.core.redis import RedisDep
from api.routers.history import CACHE_TTL_S, DaysQuery
from api.schemas.insights import (
    RankingKind,
    RankingOrder,
    Rankings,
    TimeOfDayPunctuality,
)
from api.services import insights

router = APIRouter(prefix="/rankings", tags=["rankings"])


@router.get("")
async def get_rankings(
    session: SessionDep,
    redis: RedisDep,
    kind: RankingKind = "stations",
    order: RankingOrder = "best",
    days: DaysQuery = 28,
    limit: Annotated[int, Query(ge=1, le=200)] = 20,
    min_samples: Annotated[
        int | None,
        Query(
            alias="minSamples",
            ge=1,
            description=(
                "Minimum samples to be ranked; defaults to 100 for stations, "
                "300 for lines and 15 for trains"
            ),
        ),
    ] = None,
) -> Rankings:
    """
    Stations, lines (S10, Z30, H5, ...) or trains ranked by on-time share (at
    most 5 minutes late), then by median delay. Stations and lines count every
    stop passage; trains count one arrival per run, at its last recorded stop.
    """
    threshold = (
        min_samples if min_samples is not None else insights.DEFAULT_MIN_SAMPLES[kind]
    )
    return await cached_model(
        redis,
        f"rankings:{kind}:{order}:{days}:{limit}:{threshold}",
        Rankings,
        CACHE_TTL_S,
        lambda: insights.rankings(session, kind, order, days, limit, threshold),
    )


@router.get("/time-of-day")
async def get_time_of_day_punctuality(
    session: SessionDep,
    redis: RedisDep,
    station_id: Annotated[str | None, Query(alias="stationId")] = None,
    days: DaysQuery = 28,
) -> TimeOfDayPunctuality:
    """On-time share by scheduled hour, network-wide or at one station"""
    return await cached_model(
        redis,
        f"rankings:time-of-day:{station_id or '*'}:{days}",
        TimeOfDayPunctuality,
        CACHE_TTL_S,
        lambda: insights.time_of_day(session, station_id, days),
    )
