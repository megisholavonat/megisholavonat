import { describe, expect, it } from "vitest";
import { type Follow, findFollow } from "./useFollows";

const follow = (over: Partial<Follow>): Follow => ({
    id: "f",
    trainNumber: "10",
    routeShortName: "",
    destination: "Záhony",
    fromStationId: "005510009",
    fromName: "Budapest-Keleti",
    fromLat: 0,
    fromLon: 0,
    departureS: 23 * 3600,
    weekdays: [],
    date: "2026-10-28",
    createdAt: 0,
    ...over,
});

describe("findFollow", () => {
    const today = [
        { stationId: "005510009", date: "2026-10-29" },
        { stationId: "005517228", date: "2026-10-30" },
    ];

    it("does not take yesterday's single run for today's", () => {
        expect(findFollow([follow({})], "10", today)).toBeNull();
    });

    it("finds the single run on its own date", () => {
        const single = follow({ date: "2026-10-29" });
        expect(findFollow([single], "10", today)).toBe(single);
    });

    it("finds a commute on any day", () => {
        const commute = follow({ weekdays: [1, 2, 3, 4, 5], date: null });
        expect(findFollow([commute], "10", today)).toBe(commute);
    });

    it("prefers a follow boarding on the run", () => {
        const elsewhere = follow({
            id: "a",
            weekdays: [4],
            date: null,
            fromStationId: "x",
        });
        const onRoute = follow({ id: "b", weekdays: [4], date: null });
        expect(findFollow([elsewhere, onRoute], "10", today)).toBe(onRoute);
    });
});
