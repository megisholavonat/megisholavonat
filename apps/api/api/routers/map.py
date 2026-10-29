"""Base layers of our map style, rebuilt daily and served as stored JSON"""

from typing import Any

from fastapi import APIRouter, Request, Response

from api.core.db import SessionDep
from api.core.redis import RedisDep
from api.routers.errors import UPSTREAM_ERROR_RESPONSE
from api.schemas.map import MapNetwork, MapStations
from api.services.map_layers import StoredLayer, load_layer

router = APIRouter(prefix="/map", tags=["map"], responses=UPSTREAM_ERROR_RESPONSE)

CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400"

NOT_MODIFIED_RESPONSE: dict[int | str, dict[str, Any]] = {
    304: {"description": "Unchanged since the ETag in If-None-Match"}
}


def _matches(if_none_match: str | None, etag: str) -> bool:
    if not if_none_match:
        return False
    tags = {tag.strip().removeprefix("W/") for tag in if_none_match.split(",")}
    return "*" in tags or etag in tags


def _layer_response(request: Request, layer: StoredLayer) -> Response:
    headers = {"ETag": layer.etag, "Cache-Control": CACHE_CONTROL}
    if _matches(request.headers.get("if-none-match"), layer.etag):
        return Response(status_code=304, headers=headers)
    return Response(content=layer.body, media_type="application/json", headers=headers)


@router.get("/network", response_model=MapNetwork, responses=NOT_MODIFIED_RESPONSE)
async def get_map_network(
    request: Request, redis: RedisDep, session: SessionDep
) -> Response:
    """
    The passenger rail network of the day as GeoJSON lines, each with the
    number of trains running on it (both directions)
    """
    return _layer_response(request, await load_layer(redis, session, "network"))


@router.get("/stations", response_model=MapStations, responses=NOT_MODIFIED_RESPONSE)
async def get_map_stations(
    request: Request, redis: RedisDep, session: SessionDep
) -> Response:
    """Rail stations as GeoJSON points, ranked by trains per day"""
    return _layer_response(request, await load_layer(redis, session, "stations"))
