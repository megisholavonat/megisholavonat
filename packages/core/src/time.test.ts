import { describe, expect, it } from "vitest";
import { formatSecondsAsTime, getSecondsSinceDay } from "./time";

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

    it("handles a previous-day service date across the DST change", () => {
        // 03:30 CEST on 2024-03-31, service date 2024-03-30
        const now = new Date("2024-03-31T01:30:00Z");
        expect(getSecondsSinceDay("2024-03-30", now)).toBe(
            86400 + 3 * 3600 + 30 * 60,
        );
    });
});
