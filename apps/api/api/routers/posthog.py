"""Posthog"""

from fastapi import APIRouter, HTTPException

from api.core.config import settings

router = APIRouter(prefix="/posthog", tags=["posthog"])


@router.get("")
async def get_posthog_key() -> dict[str, str]:
    """Get Posthog key"""
    try:
        return {
            "key": settings.POSTHOG_KEY,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Posthog error: {e!s}") from e
