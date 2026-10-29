"""Rail disruption alerts"""

from fastapi import APIRouter

from api.core.redis import RedisDep
from api.routers.errors import UPSTREAM_ERROR_RESPONSE
from api.schemas.alerts import Disruption, RailAlert
from api.services import disruptions
from api.services.alerts_service import get_rail_alerts

router = APIRouter(prefix="/alerts", tags=["alerts"], responses=UPSTREAM_ERROR_RESPONSE)


@router.get("")
async def get_alerts(redis: RedisDep) -> list[RailAlert]:
    """Active rail alerts (MÁV, GYSEV, HÉV), newest first"""
    return await get_rail_alerts(redis)


@router.get("/disruptions")
async def get_disruptions(redis: RedisDep) -> list[Disruption]:
    """
    Active line and network disruptions (closures, replacement buses,
    engineering works, timetable changes, strikes, weather), with the alerts
    about the same event merged. Most severe first, then newest. Per-train
    notices such as delay reasons are left out.
    """
    return await disruptions.get_disruptions(redis)
