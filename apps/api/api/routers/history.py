"""Delay history endpoints: typical delays and platform prediction"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query

from api.core.cache import cached_model
from api.core.db import SessionDep
from api.core.redis import RedisDep
from api.schemas.insights import (
    Directory,
    StationPlatforms,
    TrainHistory,
    TrainStationHistory,
)
from api.schemas.runs import RunSummary
from api.services import insights, platforms, run_summary, station_index
from api.util.history_constants import DEFAULT_HISTORY_DAYS

router = APIRouter(prefix="/history", tags=["history"])

CACHE_TTL_S = 10 * 60
# The directory follows the timetable, not the minute
DIRECTORY_TTL_S = 6 * 60 * 60

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
    days: DaysQuery = DEFAULT_HISTORY_DAYS,
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
    days: DaysQuery = DEFAULT_HISTORY_DAYS,
) -> TrainHistory:
    """Typical delay at each station of a train's usual route"""
    return await cached_model(
        redis,
        f"history:train:{train_number}:{days}",
        TrainHistory,
        CACHE_TTL_S,
        lambda: insights.train_history(session, train_number, days),
    )


@router.get("/stations/{stationId}/platforms")
async def get_station_platforms(
    station_id: StationIdPath,
    session: SessionDep,
    redis: RedisDep,
    train_number: Annotated[str | None, Query(alias="trainNumber")] = None,
    days: DaysQuery = DEFAULT_HISTORY_DAYS,
) -> StationPlatforms:
    """
    Predicted platform per train at a station: the most common one recently;
    `confident` tells whether it is sure enough to show
    """
    return await platforms.station_platforms(
        session, redis, station_id, train_number, days
    )


@router.get("/directory")
async def get_directory(
    session: SessionDep,
    redis: RedisDep,
    days: DaysQuery = DEFAULT_HISTORY_DAYS,
) -> Directory:
    """
    Domestic stations with a train on most days and train numbers that run at
    least weekly, for the website's sitemap
    """

    async def build() -> Directory:
        stations = await station_index.load_station_index(redis)
        return await insights.directory(session, stations, days)

    return await cached_model(
        redis, f"history:directory:{days}", Directory, DIRECTORY_TTL_S, build
    )


@router.get(
    "/runs/{trainNumber}/{serviceDate}",
    responses={404: {"description": "No such run on record"}},
)
async def get_run_summary(
    train_number: Annotated[
        str,
        Path(
            alias="trainNumber",
            pattern=r"^[0-9A-Za-z]{1,12}$",
            description="e.g. 10 for 10 TRANSCARPATHIA",
        ),
    ],
    service_date: Annotated[
        date,
        Path(
            alias="serviceDate",
            description="The day the run's stoptimes count from: the date it "
            "leaves its origin",
        ),
    ],
    session: SessionDep,
    redis: RedisDep,
    from_station: Annotated[
        str | None,
        Query(
            alias="from",
            pattern=r"^[0-9]{1,12}$",
            description="UIC code of the boarding station; finds a run "
            "leaving it after midnight by the date of boarding",
        ),
    ] = None,
) -> RunSummary:
    """One run of a train: its recorded delay at each stop, for sharing"""
    if not run_summary.in_range(service_date):
        raise HTTPException(status_code=404, detail="Run not found")
    summary = await run_summary.run_summary(
        session, redis, train_number, service_date, from_station
    )
    if summary is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return summary
