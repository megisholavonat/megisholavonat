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
    journeys: dict[tuple[str, str, bool], str] | None = None,
    alerts: str = "otp-alerts.json",
) -> Callable[[httpx.Request], httpx.Response]:
    """
    Dispatch on the operation name. `boards` maps (station gtfsId, kind) to
    a fixture file; unknown stations get `station: null` like upstream.
    `journeys` maps (from, to, arriveBy) to a fixture file; other plans have
    no itineraries. `alerts` is the alert feed fixture.
    """
    boards = boards or {}
    journeys = journeys or {}

    def respond(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        query: str = body["query"]
        variables = body.get("variables") or {}
        if "query Stations" in query:
            return httpx.Response(200, json=load_fixture("otp-stations.json"))
        if "query Alerts" in query:
            return httpx.Response(200, json=load_fixture(alerts))
        if "query StationBoard" in query:
            kind = "departures" if variables["omitNonPickups"] else "arrivals"
            fixture = boards.get((variables["id"], kind))
            if fixture is None:
                return httpx.Response(200, json={"data": {"station": None}})
            return httpx.Response(200, json=load_fixture(fixture))
        if "query Journeys" in query:
            key = (variables["from"], variables["to"], variables["arriveBy"])
            fixture = journeys.get(key)
            if fixture is None:
                return httpx.Response(200, json={"data": {"plan": {"itineraries": []}}})
            return httpx.Response(200, json=load_fixture(fixture))
        return httpx.Response(400, json={"errors": [{"message": "unexpected"}]})

    return respond


def graphql_route(mock: respx.MockRouter) -> respx.Route:
    return mock.post(ENDPOINT)
