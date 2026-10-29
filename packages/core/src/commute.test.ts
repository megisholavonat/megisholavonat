import { describe, expect, it } from "vitest";
import {
    currentOccurrence,
    defaultBoardingIndex,
    departureDate,
    isExpired,
    localWeekday,
    nextOccurrence,
    timeOfDay,
    tripRun,
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
    const trip = (serviceDate: string, first: number, last: number) => ({
        serviceDate,
        stoptimes: [
            { scheduledDeparture: first, scheduledArrival: first },
            { scheduledDeparture: last, scheduledArrival: last },
        ],
    });
    const unix = (iso: string) => new Date(iso).getTime() / 1000;

    it("rolls service-day times past midnight to the next date", () => {
        const late = trip("2026-10-28", 23 * H, 25 * H);
        const now = new Date("2026-10-28T21:30:00Z");
        expect(departureDate(late, 25 * H, now)).toBe("2026-10-29");
        expect(departureDate(late, 23 * H, now)).toBe("2026-10-28");
        expect(tripRun(late, 25 * H + 60, now)).toEqual({
            serviceDate: "2026-10-28",
            at: unix("2026-10-29T00:01:00Z"),
            date: "2026-10-29",
            timeOfDay: H + 60,
        });
        expect(timeOfDay(25 * H + 60)).toBe(H + 60);
    });

    it("moves a HÉV after midnight to the day it runs", () => {
        // OTP dates the 00:20 HÉV of Thursday as Wednesday, stoptime 1200
        const hev = trip("2026-10-28", 600, 3000);
        const now = new Date("2026-10-28T23:10:00Z"); // Thu 00:10
        const run = tripRun(hev, 1200, now);
        expect(run).toEqual({
            serviceDate: "2026-10-29",
            at: unix("2026-10-28T23:20:00Z"),
            date: "2026-10-29",
            timeOfDay: 1200,
        });
        const follow = {
            weekdays: [],
            departureS: run.timeOfDay,
            date: run.date,
        };
        expect(nextOccurrence(follow, now)?.departure).toBe(run.at);
        expect(isExpired(follow, now)).toBe(false);
    });

    it("moves train 10 back to the evening it leaves", () => {
        // OTP dates Thursday's 23:00 train 10 as Friday
        const ten = trip("2026-10-30", 23 * H, 32 * H);
        const now = new Date("2026-10-29T21:30:00Z"); // Thu 22:30
        expect(tripRun(ten, 23 * H, now)).toEqual({
            serviceDate: "2026-10-29",
            at: unix("2026-10-29T22:00:00Z"),
            date: "2026-10-29",
            timeOfDay: 23 * H,
        });
        expect(tripRun(ten, 26 * H, now).date).toBe("2026-10-30");
        const follow = { weekdays: [], departureS: 23 * H, date: "2026-10-29" };
        expect(nextOccurrence(follow, now)?.daysAhead).toBe(0);
    });

    it("keeps OTP's date when it already fits", () => {
        const day = trip("2026-10-29", 7 * H, 9 * H);
        expect(tripRun(day, 8 * H, THU_0800)).toMatchObject({
            serviceDate: "2026-10-29",
            date: "2026-10-29",
        });
    });

    it("counts absolute time on the night clocks go back", () => {
        // Sun 2026-10-25 03:00 CEST -> 02:00 CET
        const ten = trip("2026-10-25", 23 * H, 30 * H);
        const evening = new Date("2026-10-24T20:30:00Z"); // Sat 22:30 CEST
        expect(tripRun(ten, 23 * H, evening)).toMatchObject({
            serviceDate: "2026-10-24",
            at: unix("2026-10-24T21:00:00Z"),
            date: "2026-10-24",
        });
        // 28 h after Saturday's start is 03:00 CET, not 04:00
        expect(tripRun(ten, 28 * H, evening)).toMatchObject({
            at: unix("2026-10-25T02:00:00Z"),
            date: "2026-10-25",
            timeOfDay: 3 * H,
        });
        // A HÉV dated Saturday running 04:10 on Sunday; Sunday's service
        // day starts at 01:00 CEST (noon minus 12 h)
        const hev = trip("2026-10-24", 4 * H, 5 * H);
        const night = new Date("2026-10-25T02:50:00Z"); // Sun 03:50 CET
        expect(tripRun(hev, 4 * H + 600, night)).toEqual({
            serviceDate: "2026-10-25",
            at: unix("2026-10-25T03:10:00Z"),
            date: "2026-10-25",
            timeOfDay: 4 * H + 600,
        });
    });

    it("reads the weekday in Budapest", () => {
        // 23:30 UTC on Wednesday is already Thursday in Budapest
        expect(localWeekday(new Date("2026-10-28T23:30:00Z"))).toBe(4);
    });
});
