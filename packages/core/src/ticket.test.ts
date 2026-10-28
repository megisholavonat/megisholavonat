import { describe, expect, it } from "vitest";
import { TICKET_SHOP_URL, ticketUrl } from "./ticket";

const KELETI = "005510017";
const DEBRECEN = "005513912";

describe("ticketUrl", () => {
    it("searches both stations at the boarding time", () => {
        // Same case as apps/api/tests/test_ticket.py
        expect(ticketUrl(KELETI, DEBRECEN, 1793286300)).toBe(
            "https://jegy.mav.hu/" +
                "?from_ticketing_stop_time_id=%5B%22005510017%22%5D" +
                "&to_ticketing_stop_time_id=%5B%22005513912%22%5D" +
                "&boarding_time=%5B%222026-10-29T15%3A05%3A00.000Z%22%5D" +
                "&lang=hu",
        );
    });

    it("falls back to the shop when anything is missing", () => {
        expect(ticketUrl(null, DEBRECEN, 1793286300)).toBe(TICKET_SHOP_URL);
        expect(ticketUrl(KELETI, "", 1793286300)).toBe(TICKET_SHOP_URL);
        expect(ticketUrl(KELETI, DEBRECEN, null)).toBe(TICKET_SHOP_URL);
    });
});
