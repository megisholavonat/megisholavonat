"""Journey planner between rail stations"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from api.core.redis import RedisDep
from api.routers.errors import UPSTREAM_ERROR_RESPONSE
from api.schemas.journeys import JourneyPlan
from api.services.journeys import (
    SameStationError,
    UnknownStationError,
    get_journeys,
)

router = APIRouter(
    prefix="/journeys", tags=["journeys"], responses=UPSTREAM_ERROR_RESPONSE
)


@router.get(
    "",
    responses={
        404: {"description": "Unknown station"},
        422: {"description": "Departure and destination are the same"},
    },
)
async def plan_journeys(
    redis: RedisDep,
    from_: Annotated[
        str, Query(alias="from", description="UIC code of the departure station")
    ],
    to: Annotated[str, Query(description="UIC code of the destination station")],
    time: Annotated[
        datetime | None,
        Query(description="ISO time; local (Budapest) if no offset. Default: now"),
    ] = None,
    arriveBy: Annotated[
        bool, Query(description="Arrive by `time` instead of departing at it")
    ] = False,
    limit: Annotated[int, Query(ge=1, le=10)] = 5,
) -> JourneyPlan:
    """Itineraries between two rail stations, with live delays and ticket links"""
    try:
        return await get_journeys(redis, from_, to, time, arriveBy, limit)
    except SameStationError as e:
        raise HTTPException(
            status_code=422, detail="Departure and destination are the same"
        ) from e
    except UnknownStationError as e:
        raise HTTPException(status_code=404, detail="Station not found") from e
