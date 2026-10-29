"""Punctuality ranking endpoints"""

from typing import Annotated

from fastapi import APIRouter, Query
from redis.asyncio import Redis

from api.core.cache import cached_model
from api.core.db import SessionDep
from api.core.redis import RedisDep
from api.routers.errors import UPSTREAM_ERROR_RESPONSE
from api.routers.history import CACHE_TTL_S, DaysQuery
from api.schemas.insights import (
    RankingKind,
    RankingOrder,
    Rankings,
    TimeOfDayPunctuality,
)
from api.services import insights, station_index
from api.util.history_constants import DEFAULT_HISTORY_DAYS

router = APIRouter(
    prefix="/rankings", tags=["rankings"], responses=UPSTREAM_ERROR_RESPONSE
)


async def _non_rail_station_ids(redis: Redis) -> list[str]:
    return station_index.non_rail_station_ids(
        await station_index.load_station_index(redis)
    )


@router.get("")
async def get_rankings(
    session: SessionDep,
    redis: RedisDep,
    kind: RankingKind = "stations",
    order: RankingOrder = "best",
    days: DaysQuery = DEFAULT_HISTORY_DAYS,
    limit: Annotated[int, Query(ge=1, le=200)] = 20,
    min_samples: Annotated[
        int | None,
        Query(
            alias="minSamples",
            ge=1,
            description=(
                "Minimum samples to be ranked; defaults to 100 for stations, "
                "30 for lines and 15 for trains"
            ),
        ),
    ] = None,
) -> Rankings:
    """
    Railway stations, lines (S10, Z30, ...) or trains ranked by on-time share
    (at most 5 minutes late), then by median delay. Stations count every stop
    passage; lines and trains count one arrival per run, at its final stop (or
    the last stop recorded before it). HÉV and tram-train stops, and the runs
    ending at them, are left out.
    """
    threshold = (
        min_samples if min_samples is not None else insights.DEFAULT_MIN_SAMPLES[kind]
    )

    async def build() -> Rankings:
        non_rail = await _non_rail_station_ids(redis)
        return await insights.rankings(
            session, kind, order, days, limit, threshold, non_rail
        )

    return await cached_model(
        redis,
        f"rankings:rail:{kind}:{order}:{days}:{limit}:{threshold}",
        Rankings,
        CACHE_TTL_S,
        build,
    )


@router.get("/time-of-day")
async def get_time_of_day_punctuality(
    session: SessionDep,
    redis: RedisDep,
    station_id: Annotated[str | None, Query(alias="stationId")] = None,
    days: DaysQuery = DEFAULT_HISTORY_DAYS,
) -> TimeOfDayPunctuality:
    """
    On-time share by scheduled hour, at one station or across the railway's
    stations (without HÉV and tram-train stops)
    """

    async def build() -> TimeOfDayPunctuality:
        non_rail = [] if station_id else await _non_rail_station_ids(redis)
        return await insights.time_of_day(session, station_id, days, non_rail)

    return await cached_model(
        redis,
        f"rankings:time-of-day:rail:{station_id or '*'}:{days}",
        TimeOfDayPunctuality,
        CACHE_TTL_S,
        build,
    )
