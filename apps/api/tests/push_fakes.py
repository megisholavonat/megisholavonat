"""Fake push senders and synthetic live positions for the alert tests."""

import json
from collections.abc import Sequence
from datetime import UTC, date, datetime
from typing import Any

import fakeredis

from api.core.redis import add_key
from api.services.push_senders import (
    ExpoMessage,
    LiveActivityMessage,
    Outcome,
    SendResult,
)

# Tuesday 27 October 2026, 14:00 in Budapest (CET)
NOW = datetime(2026, 10, 27, 13, 0, tzinfo=UTC)
TODAY = date(2026, 10, 27)
TUESDAY_ONLY = 1 << 1
WEDNESDAY_ONLY = 1 << 2

DELI = "005510009"
KELENFOLD = "005501024"
ERD = "005501198"
FEHERVAR = "005501263"

# (UIC code, name, scheduled seconds since midnight, platform)
S70_STOPS = [
    (DELI, "Budapest-Déli", 13 * 3600 + 50 * 60, "1"),
    (KELENFOLD, "Kelenföld", 14 * 3600 + 32 * 60, "3"),
    (ERD, "Érd", 14 * 3600 + 45 * 60, "2"),
    (FEHERVAR, "Székesfehérvár", 15 * 3600 + 30 * 60, "4"),
]


def location(
    trip_id: str = "1:s70",
    *,
    stops: list[tuple[str, str, int, str]] | None = None,
    delay: int = 0,
    passed: int = 0,
    service_date: date = TODAY,
    name: str = "5123 személyvonat",
    route: str = "S70",
    platforms: dict[int, str] | None = None,
    off_route_m: float = 20.0,
) -> dict[str, Any]:
    """
    A processed live position. `passed` is the highest stoptime index the
    train is past (-1: standing at its origin).
    """
    stops = stops or S70_STOPS
    platforms = platforms or {}
    stoptimes = []
    for i, (uic, stop_name, t, platform) in enumerate(stops):
        platform = platforms.get(i, platform)
        stoptimes.append(
            {
                "scheduledArrival": t,
                "scheduledDeparture": t,
                "stop": {
                    "gtfsId": f"1:{uic}_{platform}",
                    "name": stop_name,
                    "platformCode": platform,
                },
            }
        )
    last = len(stops) - 1
    progress: dict[str, float]
    if passed < 0:
        progress = {"lastStopIndex": 0, "nextStopIndex": 1, "progress": 0}
        position = 0.0
    elif passed >= last:
        progress = {"lastStopIndex": last, "nextStopIndex": last, "progress": 1}
        position = last * 0.1
    else:
        progress = {
            "lastStopIndex": passed,
            "nextStopIndex": passed + 1,
            "progress": 0.2,
        }
        position = passed * 0.1 + 0.02
    return {
        "vehicleId": f"veh-{trip_id}",
        "delay": delay,
        "offRouteMeters": off_route_m,
        "trainPosition": position,
        "processedStops": [
            {"index": i, "distanceAlongRoute": i * 0.1} for i in range(len(stops))
        ],
        "vehicleProgress": progress,
        "trip": {
            "gtfsId": trip_id,
            "serviceDate": service_date.isoformat(),
            "tripShortName": name,
            "route": {"shortName": route},
            "stoptimes": stoptimes,
        },
    }


async def set_live(redis: fakeredis.FakeAsyncRedis, *locations: dict[str, Any]) -> None:
    key = add_key("train-positions-hash")
    await redis.delete(key)
    if locations:
        await redis.hset(  # type: ignore[misc]
            key, mapping={loc["vehicleId"]: json.dumps(loc) for loc in locations}
        )


class FakeExpo:
    def __init__(self) -> None:
        self.sent: list[ExpoMessage] = []
        # token -> outcome; OK otherwise
        self.outcomes: dict[str, Outcome] = {}
        self.receipt_results: dict[str, SendResult] = {}
        self.raise_for: set[str] = set()

    async def send(self, messages: Sequence[ExpoMessage]) -> list[SendResult]:
        if any(m.token in self.raise_for for m in messages):
            raise RuntimeError("boom")
        results = []
        for m in messages:
            self.sent.append(m)
            outcome = self.outcomes.get(m.token, Outcome.OK)
            results.append(
                SendResult(m.token_id, outcome, ticket_id=f"ticket-{len(self.sent)}")
            )
        return results

    async def receipts(self, ticket_ids: Sequence[str]) -> dict[str, SendResult]:
        return {
            t: self.receipt_results[t] for t in ticket_ids if t in self.receipt_results
        }

    async def aclose(self) -> None:
        pass


class FakeLiveActivity:
    def __init__(self) -> None:
        self.sent: list[LiveActivityMessage] = []
        self.outcomes: dict[str, Outcome] = {}
        # token -> APNs reason sent with a failed outcome
        self.errors: dict[str, str] = {}

    async def send(self, messages: Sequence[LiveActivityMessage]) -> list[SendResult]:
        self.sent.extend(messages)
        return [
            SendResult(
                m.token_id,
                self.outcomes.get(m.token, Outcome.OK),
                self.errors.get(m.token),
            )
            for m in messages
        ]

    async def aclose(self) -> None:
        pass
