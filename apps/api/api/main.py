from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.routing import APIRoute, APIRouter
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from api.core.client_ip import ClientIPHeaderMiddleware
from api.core.config import settings
from api.core.db import engine
from api.core.logging_config import get_logger, setup_logging
from api.core.taskiq_broker import broker
from api.routers import (
    alerts,
    devices,
    follows,
    history,
    posthog,
    rankings,
    redis_test,
    root,
    stations,
    trains,
)
from api.routers.errors import register_error_handlers

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
    await broker.startup()

    yield

    # Shutdown
    await broker.shutdown()
    await engine.dispose()


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
    v1_router.include_router(stations.router)
    v1_router.include_router(alerts.router)
    v1_router.include_router(devices.router)
    v1_router.include_router(follows.router)
    v1_router.include_router(history.router)
    v1_router.include_router(rankings.router)

    register_error_handlers(app)

    # Behind reverse proxies the client address comes from X-Forwarded-For,
    # but only for requests arriving from a proxy listed in TRUSTED_PROXIES.
    # Uvicorn's own proxy header handling is disabled (--no-proxy-headers), so
    # this is the one place deciding which forwarded headers to believe.
    if settings.trusted_proxies:
        app.add_middleware(
            ProxyHeadersMiddleware,
            trusted_hosts=settings.trusted_proxies,  # type: ignore[arg-type]
        )
        # Added last so it runs first and sees the raw TCP peer
        if settings.CLIENT_IP_HEADER:
            app.add_middleware(
                ClientIPHeaderMiddleware,
                header=settings.CLIENT_IP_HEADER,
                trusted_proxies=settings.trusted_proxies,
            )

    app.include_router(root.router)
    app.include_router(v1_router)

    return app


# Create the app instance
app = create_app()
