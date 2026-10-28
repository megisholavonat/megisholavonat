"""Station search and departure/arrival boards"""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from api.core.redis import RedisDep
from api.routers.errors import UPSTREAM_ERROR_RESPONSE
from api.schemas.stations import BoardKind, Station, StationBoard
from api.services import station_index
from api.services.station_board import StationNotFoundError, get_board

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


@router.get(
    "/{stationId}/departures",
    responses={404: {"description": "Unknown station"}},
)
async def get_station_board(
    redis: RedisDep,
    stationId: str,
    kind: BoardKind = "departures",
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> StationBoard:
    """Departure or arrival board of a station, merged across its platforms"""
    try:
        return await get_board(redis, stationId, kind, limit)
    except StationNotFoundError as e:
        raise HTTPException(status_code=404, detail="Station not found") from e
