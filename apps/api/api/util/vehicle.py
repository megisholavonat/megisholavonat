import time
from typing import Any

REMOVAL_THRESHOLD_MINUTES = 120


def should_remove(vehicle_position: dict[str, Any]) -> bool:
    """
    Determines if a vehicle position is too stale to display.
    """
    now = time.time()
    last_updated: int = vehicle_position.get("lastUpdated", 0)

    minutes_since_update = (now - last_updated) / 60

    return minutes_since_update > REMOVAL_THRESHOLD_MINUTES
