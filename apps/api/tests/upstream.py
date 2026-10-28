"""Mocked upstream OTP endpoint serving captured responses."""

import json
from collections.abc import Callable
from typing import Any

import httpx
import respx

from tests.conftest import FIXTURES

ENDPOINT = "http://otp.test/otp/gtfs/v1"


def load_fixture(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text())


def otp_responder(
    boards: dict[tuple[str, str], str] | None = None,
) -> Callable[[httpx.Request], httpx.Response]:
    """
    Dispatch on the operation name. `boards` maps (station gtfsId, kind) to
    a fixture file; unknown stations get `station: null` like upstream.
    """
    boards = boards or {}

    def respond(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        query: str = body["query"]
        variables = body.get("variables") or {}
        if "query Stations" in query:
            return httpx.Response(200, json=load_fixture("otp-stations.json"))
        if "query Alerts" in query:
            return httpx.Response(200, json=load_fixture("otp-alerts.json"))
        if "query StationBoard" in query:
            kind = "departures" if variables["omitNonPickups"] else "arrivals"
            fixture = boards.get((variables["id"], kind))
            if fixture is None:
                return httpx.Response(200, json={"data": {"station": None}})
            return httpx.Response(200, json=load_fixture(fixture))
        return httpx.Response(400, json={"errors": [{"message": "unexpected"}]})

    return respond


def graphql_route(mock: respx.MockRouter) -> respx.Route:
    return mock.post(ENDPOINT)
