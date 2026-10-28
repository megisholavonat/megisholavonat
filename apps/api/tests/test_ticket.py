import pytest

from api.util.ticket import TICKET_SHOP_URL, ticket_url

KELETI = "005510017"
DEBRECEN = "005513912"


def test_ticket_url_searches_both_stations_at_boarding_time() -> None:
    # Same case as packages/core/src/ticket.test.ts
    url = ticket_url(KELETI, DEBRECEN, 1793286300)  # 2026-10-29 16:05 CET

    assert url == (
        "https://jegy.mav.hu/"
        "?from_ticketing_stop_time_id=%5B%22005510017%22%5D"
        "&to_ticketing_stop_time_id=%5B%22005513912%22%5D"
        "&boarding_time=%5B%222026-10-29T15%3A05%3A00.000Z%22%5D"
        "&lang=hu"
    )


@pytest.mark.parametrize(
    ("from_uic", "to_uic", "departure"),
    [
        (None, DEBRECEN, 1793286300),
        (KELETI, "", 1793286300),
        (KELETI, DEBRECEN, None),
    ],
)
def test_ticket_url_falls_back_to_the_shop(
    from_uic: str | None, to_uic: str | None, departure: int | None
) -> None:
    assert ticket_url(from_uic, to_uic, departure) == TICKET_SHOP_URL
