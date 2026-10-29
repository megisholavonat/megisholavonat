from datetime import datetime
from typing import Any

from api.services.train_service import TrainService
from api.util.time import BUDAPEST_TZ


def _unix(local: str) -> int:
    return int(datetime.fromisoformat(local).replace(tzinfo=BUDAPEST_TZ).timestamp())


def _loc(trip_id: str, first_dep: int, last_arr: int, updated: int) -> dict[str, Any]:
    return {
        "vehicleId": "1:123",
        "lastUpdated": updated,
        "trip": {
            "gtfsId": trip_id,
            "serviceDate": "2026-08-14",
            "stoptimes": [
                {"scheduledArrival": first_dep, "scheduledDeparture": first_dep},
                {"scheduledArrival": last_arr, "scheduledDeparture": last_arr},
            ],
        },
    }


def test_dedupe_prefers_in_service_trip_on_tie() -> None:
    now = _unix("2026-08-14T10:30:00")
    running = _loc("running", 10 * 3600, 11 * 3600, now)
    next_trip = _loc("next", 12 * 3600, 13 * 3600, now)

    for order in ([running, next_trip], [next_trip, running]):
        result = TrainService(None).dedupe_by_vehicle_id(order)  # type: ignore[arg-type]
        assert [r["trip"]["gtfsId"] for r in result] == ["running"]


def test_dedupe_falls_back_to_latest_update() -> None:
    now = _unix("2026-08-14T10:30:00")
    older = _loc("a", 10 * 3600, 11 * 3600, now - 60)
    newer = _loc("b", 10 * 3600, 11 * 3600, now)

    result = TrainService(None).dedupe_by_vehicle_id([older, newer])  # type: ignore[arg-type]

    assert [r["trip"]["gtfsId"] for r in result] == ["b"]


def test_dedupe_handles_trips_past_midnight() -> None:
    # Service date 2026-08-14, running 23:30 -> 00:40 (stoptimes > 86400)
    now = _unix("2026-08-15T00:20:00")
    night = _loc("night", 23 * 3600 + 1800, 24 * 3600 + 2400, now)
    morning = _loc("morning", 5 * 3600, 6 * 3600, now)
    morning["trip"]["serviceDate"] = "2026-08-15"

    result = TrainService(None).dedupe_by_vehicle_id([morning, night])  # type: ignore[arg-type]

    assert [r["trip"]["gtfsId"] for r in result] == ["night"]


def test_dedupe_keeps_trip_arriving_at_terminus() -> None:
    # Arrived 2 minutes late; the vehicle's next trip leaves in 8 minutes
    now = _unix("2026-08-14T11:02:00")
    arriving = _loc("arriving", 10 * 3600, 11 * 3600, now)
    next_trip = _loc("next", 11 * 3600 + 600, 12 * 3600, now)

    result = TrainService(None).dedupe_by_vehicle_id([next_trip, arriving])  # type: ignore[arg-type]

    assert [r["trip"]["gtfsId"] for r in result] == ["arriving"]


def test_dedupe_keeps_late_trip_past_its_scheduled_end() -> None:
    # Scheduled to arrive 10:00 but running 25 minutes late; the vehicle's
    # next trip is scheduled to leave at 10:30
    now = _unix("2026-08-14T10:20:00")
    late = _loc("late", 9 * 3600, 10 * 3600, now)
    late["trip"]["stoptimes"][-1]["realtimeArrival"] = 10 * 3600 + 25 * 60
    next_trip = _loc("next", 10 * 3600 + 1800, 11 * 3600, now)

    result = TrainService(None).dedupe_by_vehicle_id([next_trip, late])  # type: ignore[arg-type]

    assert [r["trip"]["gtfsId"] for r in result] == ["late"]
