"""Station search and departure/arrival boards"""

from typing import Annotated

from fastapi import APIRouter, Query

from api.core.redis import RedisDep
from api.routers.errors import UPSTREAM_ERROR_RESPONSE
from api.schemas.stations import Station
from api.services import station_index

router = APIRouter(
    prefix="/stations", tags=["stations"], responses=UPSTREAM_ERROR_RESPONSE
)


@router.get("")
async def search_stations(
    redis: RedisDep,
    q: Annotated[str, Query(min_length=1, max_length=100)],
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> list[Station]:
    """Search rail stations by name, ignoring accents"""
    stations = await station_index.load_station_index(redis)
    return station_index.search_stations(stations, q, limit)
