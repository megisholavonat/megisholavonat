from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.routing import APIRoute, APIRouter

from api.core.config import settings
from api.core.logging_config import get_logger, setup_logging
from api.core.taskiq_broker import broker
from api.routers import posthog, redis_test, root, trains

# Initialize logging
setup_logging()
logger = get_logger(__name__)


def custom_generate_unique_id(route: APIRoute) -> str:
    if route.operation_id:
        return route.operation_id

    name_parts = route.name.split("_")
    return name_parts[0] + "".join(part.capitalize() for part in name_parts[1:])


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    await broker.startup()

    # Startup
    if settings.DEBUG:
        import redis.asyncio as redis

        from api.core.redis import redis_pool

        async with redis.Redis(connection_pool=redis_pool) as client:
            try:
                await client.flushdb()
                logger.info("Redis cache cleared on startup")
            except Exception as e:
                logger.warning(f"Could not clear Redis cache: {e}")

    yield

    # Shutdown
    await broker.shutdown()


def create_app() -> FastAPI:
    """
    Create and configure the FastAPI application.

    Returns:
        FastAPI: Configured FastAPI application instance
    """
    app = FastAPI(
        lifespan=lifespan,
        root_path="/api",
        generate_unique_id_function=custom_generate_unique_id,
    )

    v1_router = APIRouter(prefix="/v1")

    # Include routers
    v1_router.include_router(redis_test.router)
    v1_router.include_router(trains.router)
    v1_router.include_router(posthog.router)

    app.include_router(root.router)
    app.include_router(v1_router)

    return app


# Create the app instance
app = create_app()
