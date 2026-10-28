/**
 * Links into MÁV's ticket shop.
 *
 * The shop reads the search from the query string and starts it on load: both
 * stations as UIC codes and the boarding time in UTC, each wrapped in a JSON
 * array. There is no parameter for a specific train.
 *
 * Mirrors apps/api/api/util/ticket.py; the tests of both share the same cases.
 */

export const TICKET_SHOP_URL = "https://jegy.mav.hu/";

/**
 * Shop link searching from `fromUic` to `toUic` at `departure` (unix
 * seconds). Falls back to the shop's start page if anything is missing.
 */
export function ticketUrl(
    fromUic: string | null | undefined,
    toUic: string | null | undefined,
    departure: number | null | undefined,
): string {
    if (!fromUic || !toUic || departure == null) {
        return TICKET_SHOP_URL;
    }

    const query = new URLSearchParams({
        from_ticketing_stop_time_id: JSON.stringify([fromUic]),
        to_ticketing_stop_time_id: JSON.stringify([toUic]),
        boarding_time: JSON.stringify([
            new Date(departure * 1000).toISOString(),
        ]),
        lang: "hu",
    });
    return `${TICKET_SHOP_URL}?${query.toString()}`;
}
