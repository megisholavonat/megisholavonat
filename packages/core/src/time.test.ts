import { describe, expect, it } from "vitest";
import {
    budapestDate,
    formatSecondsAsTime,
    getSecondsSinceDay,
    isoWeekday,
    secondsIntoServiceDay,
    serviceDayStart,
    shiftDate,
} from "./time";

describe("calendar helpers", () => {
    it("takes the date in Budapest, not UTC", () => {
        expect(budapestDate(new Date("2026-10-28T23:30:00Z"))).toBe(
            "2026-10-29",
        );
    });

    it("shifts across month ends", () => {
        expect(shiftDate("2026-10-31", 1)).toBe("2026-11-01");
        expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    });

    it("numbers weekdays from Monday", () => {
        expect(isoWeekday("2026-10-26")).toBe(1);
        expect(isoWeekday("2026-11-01")).toBe(7);
    });
});

describe("formatSecondsAsTime", () => {
    it("formats midnight", () => {
        expect(formatSecondsAsTime(0)).toBe("00:00");
    });

    it("wraps times past 24h", () => {
        // 25h 1m 0s
        expect(formatSecondsAsTime(90060)).toBe("01:01");
    });
});

describe("getSecondsSinceDay", () => {
    it("counts past midnight for a previous-day service date", () => {
        // 00:30 in Budapest (CET, UTC+1) on the day after the service date
        const now = new Date("2024-01-01T23:30:00Z");
        expect(getSecondsSinceDay("2024-01-01", now)).toBe(86400 + 30 * 60);
    });

    it("uses Budapest wall-clock time on the spring DST change", () => {
        // 12:00 CEST on 2024-03-31; clocks jumped 02:00 -> 03:00 that night
        const now = new Date("2024-03-31T10:00:00Z");
        expect(getSecondsSinceDay("2024-03-31", now)).toBe(12 * 3600);
    });

    it("counts a previous-day service date from noon minus 12h", () => {
        // 03:30 CEST on 2024-03-31, service date 2024-03-30: the day started
        // at midnight CET, and one hour was skipped since
        const now = new Date("2024-03-31T01:30:00Z");
        expect(getSecondsSinceDay("2024-03-30", now)).toBe(
            86400 + 2 * 3600 + 30 * 60,
        );
    });

    // Mirrors apps/api/tests/test_service_time.py
    it.each([
        // Same day, after the spring change: 10:00 CEST reads as 10:00
        ["2026-03-29", "2026-03-29T08:00:00Z", 10 * 3600],
        // Same day, after the autumn change: 10:00 CET reads as 10:00
        ["2026-10-25", "2026-10-25T09:00:00Z", 10 * 3600],
        // Previous-day service date across the spring change
        ["2026-03-28", "2026-03-29T04:00:00Z", 29 * 3600],
        ["2026-03-28", "2026-03-28T22:30:00Z", 23 * 3600 + 1800],
        // Previous-day service date across the autumn change
        ["2026-10-24", "2026-10-24T22:30:00Z", 24 * 3600 + 1800],
        ["2026-10-24", "2026-10-25T04:00:00Z", 30 * 3600],
        // Normal night: 00:30 CET the day after the service date
        ["2026-01-15", "2026-01-15T23:30:00Z", 24 * 3600 + 1800],
    ])("%s at %s is %i s in", (serviceDate, now, expected) => {
        expect(getSecondsSinceDay(serviceDate, new Date(now))).toBe(expected);
    });

    it("assumes today's service day for an unknown date", () => {
        // 08:00 CEST
        const now = new Date("2026-08-20T06:00:00Z");
        expect(getSecondsSinceDay("", now)).toBe(8 * 3600);
    });
});

describe("serviceDayStart", () => {
    it.each([
        // Local midnight on normal days, CET and CEST
        ["2026-01-15", "2026-01-14T23:00:00Z"],
        ["2026-08-20", "2026-08-19T22:00:00Z"],
        // Spring forward: 23:00 CET the night before
        ["2026-03-29", "2026-03-28T22:00:00Z"],
        // Fall back: 01:00 CEST that night
        ["2026-10-25", "2026-10-24T23:00:00Z"],
    ])("%s starts at %s", (serviceDate, start) => {
        expect(serviceDayStart(serviceDate)).toBe(new Date(start).getTime());
    });
});

// Mirrors apps/api/tests/test_midnight_delay.py
describe("secondsIntoServiceDay", () => {
    function trip(serviceDate: string, first: number, last: number) {
        return {
            serviceDate,
            stoptimes: [
                { scheduledDeparture: first, scheduledArrival: first },
                { scheduledDeparture: last, scheduledArrival: last },
            ],
        };
    }

    it("uses the next date for an after-midnight HÉV trip", () => {
        // 00:18 on 08-15 listed as 1080 on 08-14; now 00:25 CEST on 08-15
        const now = new Date("2026-08-14T22:25:00Z");
        expect(secondsIntoServiceDay(trip("2026-08-14", 1080, 2880), now)).toBe(
            25 * 60,
        );
    });

    it("uses the next date while waiting before midnight", () => {
        // 23:53 CEST on 08-14 for a 00:13 departure listed under 08-14
        const now = new Date("2026-08-14T21:53:00Z");
        expect(secondsIntoServiceDay(trip("2026-08-14", 780, 2580), now)).toBe(
            -7 * 60,
        );
    });

    it("uses the previous date for an overnight train", () => {
        // Departed 22:40 on 08-14 but listed under 08-15; now 04:03 on 08-15
        const now = new Date("2026-08-15T02:03:00Z");
        expect(
            secondsIntoServiceDay(trip("2026-08-15", 81600, 122400), now),
        ).toBe(28 * 3600 + 3 * 60);
    });

    it("keeps the date of a finished trip", () => {
        // Ran 04:30-12:56; still attached at 20:43 the same day
        const now = new Date("2026-08-20T18:43:00Z");
        expect(
            secondsIntoServiceDay(trip("2026-08-20", 16140, 46560), now),
        ).toBe(20 * 3600 + 43 * 60);
    });

    it("keeps the date without a schedule", () => {
        const now = new Date("2026-08-14T22:25:00Z");
        expect(secondsIntoServiceDay({ serviceDate: "2026-08-14" }, now)).toBe(
            24 * 3600 + 25 * 60,
        );
    });
});
