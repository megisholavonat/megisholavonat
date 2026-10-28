"""Rail disruption alerts"""

from fastapi import APIRouter

from api.core.redis import RedisDep
from api.routers.errors import UPSTREAM_ERROR_RESPONSE
from api.schemas.alerts import RailAlert
from api.services.alerts_service import get_rail_alerts

router = APIRouter(prefix="/alerts", tags=["alerts"], responses=UPSTREAM_ERROR_RESPONSE)


@router.get("")
async def get_alerts(redis: RedisDep) -> list[RailAlert]:
    """Active rail alerts (MÁV, GYSEV, HÉV), newest first"""
    return await get_rail_alerts(redis)
