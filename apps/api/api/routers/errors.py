"""Shared error handling for endpoints backed by the upstream timetable"""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from api.core.graphql import UpstreamError

UPSTREAM_ERROR_RESPONSE: dict[int | str, dict[str, Any]] = {
    502: {"description": "The upstream timetable service failed"}
}


async def _upstream_error_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=502, content={"detail": str(exc)})


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(UpstreamError, _upstream_error_handler)
