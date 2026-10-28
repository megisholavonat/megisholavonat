from datetime import UTC, date, datetime

import pytest

from api.util.time import get_seconds_since_day, service_day_start


def _utc(iso: str) -> datetime:
    return datetime.fromisoformat(iso).replace(tzinfo=UTC)


def test_service_day_starts_at_local_midnight_on_normal_days() -> None:
    # CET (UTC+1) in winter, CEST (UTC+2) in summer
    assert service_day_start(date(2026, 1, 15)) == _utc("2026-01-14T23:00:00")
    assert service_day_start(date(2026, 8, 20)) == _utc("2026-08-19T22:00:00")


@pytest.mark.parametrize(
    ("service_date", "start"),
    [
        # Spring forward (02:00 -> 03:00 on 2026-03-29): 23:00 CET the night before
        ("2026-03-29", "2026-03-28T22:00:00"),
        # Fall back (03:00 -> 02:00 on 2026-10-25): 01:00 CEST that night
        ("2026-10-25", "2026-10-24T23:00:00"),
    ],
)
def test_service_day_start_is_noon_minus_12h_on_dst_days(
    service_date: str, start: str
) -> None:
    assert service_day_start(date.fromisoformat(service_date)) == _utc(start)


@pytest.mark.parametrize(
    ("service_date", "now", "expected"),
    [
        # Same day, after the spring change: 10:00 CEST reads as 10:00
        ("2026-03-29", "2026-03-29T08:00:00", 10 * 3600),
        # Same day, after the autumn change: 10:00 CET reads as 10:00
        ("2026-10-25", "2026-10-25T09:00:00", 10 * 3600),
        # Previous-day service date across the spring change: midnight CET,
        # so 06:00 CEST the next morning is 29h in (one hour was skipped)
        ("2026-03-28", "2026-03-29T04:00:00", 29 * 3600),
        ("2026-03-28", "2026-03-28T22:30:00", 23 * 3600 + 1800),
        # Previous-day service date across the autumn change: midnight CEST,
        # so 05:00 CET the next morning is 30h in (one hour was repeated)
        ("2026-10-24", "2026-10-24T22:30:00", 24 * 3600 + 1800),
        ("2026-10-24", "2026-10-25T04:00:00", 30 * 3600),
        # Normal night: 00:30 CET the day after the service date
        ("2026-01-15", "2026-01-15T23:30:00", 24 * 3600 + 1800),
    ],
)
def test_seconds_since_day(service_date: str, now: str, expected: int) -> None:
    assert get_seconds_since_day(service_date, _utc(now)) == expected


def test_naive_datetime_is_utc() -> None:
    naive = datetime(2026, 8, 20, 8, 0)
    assert get_seconds_since_day("2026-08-20", naive) == 10 * 3600
