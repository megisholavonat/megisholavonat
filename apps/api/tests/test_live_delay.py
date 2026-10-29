import pytest

from api.services.live_trips import LiveTrip, StopDelay, apply_live_delay
from api.util.delay import to_minutes

SCHEDULED = 1_800_000_000


@pytest.mark.parametrize(
    ("seconds", "minutes"),
    [
        (0, 0),
        (29, 0),
        (30, 1),
        (90, 2),
        # Halves round up, as Math.round on the clients (round() gives 2)
        (150, 3),
        (-30, 0),
        (-90, -1),
        (-150, -2),
        (299.9, 5),
    ],
)
def test_to_minutes_rounds_half_up(seconds: float, minutes: int) -> None:
    assert to_minutes(seconds) == minutes


def live(delay: int, activity: str | None = None) -> LiveTrip:
    return LiveTrip(vehicleId="v1", delay=delay, activity=activity)


def test_gps_delay_replaces_the_timetable() -> None:
    assert apply_live_delay(
        live(7), SCHEDULED, SCHEDULED + 120, realtime=False, departing=True
    ) == StopDelay(7, SCHEDULED + 420, "gps", True)


def test_trains_do_not_leave_early() -> None:
    gps = apply_live_delay(
        live(-3), SCHEDULED, SCHEDULED, realtime=True, departing=True
    )
    assert gps == StopDelay(0, SCHEDULED, "gps", True)
    otp = apply_live_delay(
        None, SCHEDULED, SCHEDULED - 120, realtime=True, departing=True
    )
    assert otp == StopDelay(0, SCHEDULED, "otp", True)


def test_trains_may_arrive_early() -> None:
    gps = apply_live_delay(
        live(-3), SCHEDULED, SCHEDULED, realtime=True, departing=False
    )
    assert gps == StopDelay(-3, SCHEDULED - 180, "gps", True)
    otp = apply_live_delay(
        None, SCHEDULED, SCHEDULED - 120, realtime=True, departing=False
    )
    assert otp == StopDelay(-2, SCHEDULED - 120, "otp", True)


def test_no_live_delay_off_route_falls_back_to_the_timetable() -> None:
    assert apply_live_delay(
        live(9, "offRoute"), SCHEDULED, SCHEDULED + 150, realtime=True, departing=True
    ) == StopDelay(3, SCHEDULED + 150, "otp", True)
