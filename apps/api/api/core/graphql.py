"""Shared client for the upstream OTP GraphQL endpoint.

Every upstream call goes through here so the SOCKS5 proxy, timeouts and error
handling are configured in one place.
"""

from typing import Any

import httpx
from httpx_socks import AsyncProxyTransport  # type: ignore[import-untyped]

from api.core.config import settings
from api.core.logging_config import get_logger

logger = get_logger(__name__)

DEFAULT_TIMEOUT = 30.0


class UpstreamError(Exception):
    """The upstream GraphQL endpoint failed or returned an unusable response."""


def _proxy_transport() -> AsyncProxyTransport | None:
    if not settings.SOCKS5_PROXY_ENABLE:
        return None

    if not settings.SOCKS5_PROXY_HOST or not settings.SOCKS5_PROXY_PORT:
        raise ValueError("Proxy is enabled but HOST or PORT is not set.")

    proxy_url = "socks5://"
    if settings.SOCKS5_PROXY_USERNAME and settings.SOCKS5_PROXY_PASSWORD:
        username = settings.SOCKS5_PROXY_USERNAME
        password = settings.SOCKS5_PROXY_PASSWORD
        proxy_url += f"{username}:{password}@"

    proxy_url += f"{settings.SOCKS5_PROXY_HOST}:{settings.SOCKS5_PROXY_PORT}"

    return AsyncProxyTransport.from_url(proxy_url)


async def post_graphql(
    query: str,
    variables: dict[str, Any] | None = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """
    POST a query and return the raw JSON body. Raises httpx errors as-is.
    """
    if not settings.GRAPHQL_ENDPOINT:
        raise ValueError("GRAPHQL_ENDPOINT is not set.")

    payload: dict[str, Any] = {"query": query}
    if variables:
        payload["variables"] = variables

    async with httpx.AsyncClient(transport=_proxy_transport()) as client:
        response = await client.post(
            settings.GRAPHQL_ENDPOINT, json=payload, timeout=timeout
        )
        response.raise_for_status()
        result: dict[str, Any] = response.json()
        return result


async def query_graphql(
    query: str,
    variables: dict[str, Any] | None = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """
    Run a query and return its `data`. Any transport, HTTP or GraphQL error
    is raised as UpstreamError.
    """
    try:
        result = await post_graphql(query, variables, timeout)
    except (httpx.HTTPError, ValueError) as e:
        logger.error(f"Upstream GraphQL request failed: {e!r}")
        raise UpstreamError("Upstream timetable service is unavailable") from e

    errors = result.get("errors")
    data = result.get("data")
    if errors or not isinstance(data, dict):
        logger.error(f"Upstream GraphQL returned errors: {errors}")
        raise UpstreamError("Upstream timetable service returned an error")

    return data
