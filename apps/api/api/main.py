from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute

from api.core.config import settings
from api.core.logging_config import get_logger, setup_logging
from api.routers import redis_test, trains

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


def create_app() -> FastAPI:
    """
    Create and configure the FastAPI application.

    Returns:
        FastAPI: Configured FastAPI application instance
    """
    app = FastAPI(
        lifespan=lifespan, generate_unique_id_function=custom_generate_unique_id
    )

    # Configure CORS
    allowed_origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["GET"],
        allow_headers=["*"],
    )

    # Include routers
    app.include_router(redis_test.router)
    app.include_router(trains.router)

    # Root endpoint
    @app.get("/")
    def home():
        return {"message": "mháv"}

    return app


# Create the app instance
app = create_app()
