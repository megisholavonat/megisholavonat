import { describe, expect, it } from "vitest";
import {
    currentOccurrence,
    defaultBoardingIndex,
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

describe("currentOccurrence", () => {
    // Thursday 04:00 in Budapest
    const THU_0400 = new Date("2026-10-29T03:00:00Z");
    // 7 RUTH, followed at Chop 00:02, Mon-Fri, four hours into its run
    const chop = { weekdays: [1, 2, 3, 4, 5], departureS: 2 * 60 };

    it("keeps today's run while the train is on the rails", () => {
        expect(nextOccurrence(chop, THU_0400)?.daysAhead).toBe(1);
        expect(currentOccurrence(chop, THU_0400, false)?.daysAhead).toBe(1);
        expect(currentOccurrence(chop, THU_0400, true)).toMatchObject({
            date: "2026-10-29",
            daysAhead: 0,
        });
    });

    it("keeps a run until its scheduled arrival", () => {
        const withRun = { ...chop, runS: 6 * H };
        expect(currentOccurrence(withRun, THU_0400)?.daysAhead).toBe(0);
        const later = new Date("2026-10-29T06:30:00Z");
        expect(currentOccurrence(withRun, later)?.daysAhead).toBe(1);
    });

    it("keeps last night's run across midnight", () => {
        // Boarded at 23:00 on Wednesday, Thursday 02:00 now
        const night = { weekdays: [3, 4], departureS: 23 * H };
        const now = new Date("2026-10-29T01:00:00Z");
        expect(currentOccurrence(night, now, true)).toMatchObject({
            date: "2026-10-28",
            daysAhead: -1,
        });
        expect(currentOccurrence(night, now, false)?.date).toBe("2026-10-29");
    });

    it("prefers today's run ahead when the train is on its way to it", () => {
        // Boarding at 05:00; a run of the train is already out at 04:00
        const morning = { weekdays: [1, 2, 3, 4, 5], departureS: 5 * H };
        expect(currentOccurrence(morning, THU_0400, true)).toMatchObject({
            date: "2026-10-29",
            daysAhead: 0,
        });
    });
});

describe("defaultBoardingIndex", () => {
    const route = ["chop", "zahony", "nyiregyhaza", "szolnok", "budapest"];

    it("boards at the next stop, not the passed origin", () => {
        expect(defaultBoardingIndex(route, 2)).toBe(2);
        expect(defaultBoardingIndex(route, null)).toBe(0);
    });

    it("prefers a recent station still ahead", () => {
        expect(defaultBoardingIndex(route, 2, ["chop", "szolnok"])).toBe(3);
        expect(defaultBoardingIndex(route, 2, ["chop"])).toBe(2);
    });

    it("never suggests the last stop", () => {
        expect(defaultBoardingIndex(route, 4, ["budapest"])).toBe(3);
        expect(defaultBoardingIndex(["a"], 0)).toBe(0);
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
