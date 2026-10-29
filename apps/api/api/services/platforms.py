"""Predicted platforms, cached for the history API and the push alerts alike."""

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.cache import cached_model
from api.schemas.insights import StationPlatforms
from api.services import insights

# Platform history moves slowly: it covers weeks of service dates. The key
# version changes with the shape of StationPlatforms.
PLATFORMS_TTL_S = 60 * 60


async def station_platforms(
    session: AsyncSession,
    redis: Redis,
    station: str,
    train_number: str | None,
    days: int,
) -> StationPlatforms:
    """`insights.station_platforms`, cached for PLATFORMS_TTL_S."""
    return await cached_model(
        redis,
        f"history:platforms:v2:{station}:{train_number or '*'}:{days}",
        StationPlatforms,
        PLATFORMS_TTL_S,
        lambda: insights.station_platforms(session, station, train_number, days),
    )
