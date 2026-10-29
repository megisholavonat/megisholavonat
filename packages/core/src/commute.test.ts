import { describe, expect, it } from "vitest";
import {
    departureDate,
    isExpired,
    localWeekday,
    nextOccurrence,
    timeOfDay,
} from "./commute";

// Thursday 2026-10-29, 08:00 in Budapest (CET, UTC+1)
const THU_0800 = new Date("2026-10-29T07:00:00Z");
const H = 3600;

describe("nextOccurrence", () => {
    it("picks today while the train has not left", () => {
        const next = nextOccurrence(
            { weekdays: [1, 2, 3, 4, 5], departureS: 17 * H + 24 * 60 },
            THU_0800,
        );
        expect(next).toMatchObject({ date: "2026-10-29", daysAhead: 0 });
        expect(next?.departure).toBe(
            new Date("2026-10-29T16:24:00Z").getTime() / 1000,
        );
    });

    it("keeps today's run for an hour after departure", () => {
        const next = nextOccurrence(
            { weekdays: [4, 5], departureS: 7 * H + 19 * 60 },
            THU_0800,
        );
        expect(next).toMatchObject({ date: "2026-10-29", daysAhead: 0 });
    });

    it("moves on to the next matching day", () => {
        const next = nextOccurrence(
            { weekdays: [1, 4], departureS: 6 * H },
            THU_0800,
        );
        expect(next).toMatchObject({
            date: "2026-11-02",
            daysAhead: 4,
            weekday: 1,
        });
    });

    it("finds the same weekday a week later", () => {
        const next = nextOccurrence(
            { weekdays: [4], departureS: 5 * H },
            THU_0800,
        );
        expect(next).toMatchObject({ date: "2026-11-05", daysAhead: 7 });
    });

    it("handles a single run", () => {
        const schedule = {
            weekdays: [],
            departureS: 9 * H,
            date: "2026-10-29",
        };
        expect(nextOccurrence(schedule, THU_0800)?.daysAhead).toBe(0);
        expect(isExpired(schedule, THU_0800)).toBe(false);
        const later = new Date("2026-10-29T12:00:00Z");
        expect(nextOccurrence(schedule, later)).toBeNull();
        expect(isExpired(schedule, later)).toBe(true);
    });

    it("never expires a weekly follow", () => {
        expect(isExpired({ weekdays: [1], departureS: 0 }, THU_0800)).toBe(
            false,
        );
    });
});

describe("departure day", () => {
    it("rolls service-day times past midnight to the next date", () => {
        expect(departureDate("2026-10-28", 25 * H)).toBe("2026-10-29");
        expect(departureDate("2026-10-28", 23 * H)).toBe("2026-10-28");
        expect(timeOfDay(25 * H + 60)).toBe(H + 60);
    });

    it("reads the weekday in Budapest", () => {
        // 23:30 UTC on Wednesday is already Thursday in Budapest
        expect(localWeekday(new Date("2026-10-28T23:30:00Z"))).toBe(4);
    });
});
