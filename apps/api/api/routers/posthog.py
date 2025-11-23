"""Posthog"""

from fastapi import APIRouter
from pydantic import BaseModel

from api.core.config import settings

router = APIRouter(prefix="/posthog", tags=["posthog"])


class PosthogKey(BaseModel):
    key: str | None


@router.get("")
async def get_posthog_key() -> PosthogKey:
    """Get Posthog key"""
    return PosthogKey(key=settings.POSTHOG_KEY)
