import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    budapestToday,
    dateDialogDate,
    timeDialogDate,
    withPickedDate,
    withPickedTime,
} from "./pickerTime";

// A visitor's phone on London time: an hour behind Budapest
const zone = process.env.TZ;
beforeEach(() => {
    process.env.TZ = "Europe/London";
});
afterEach(() => {
    process.env.TZ = zone;
});

// 14:05 in Budapest, 13:05 in London
const NOW = Date.parse("2026-10-29T13:05:00Z");

describe("planner pickers on a phone in another time zone", () => {
    it("shows the Budapest time in the time dialog", () => {
        const date = timeDialogDate(NOW);
        expect([date.getHours(), date.getMinutes()]).toEqual([14, 5]);
    });

    it("reads the picked time as Budapest time", () => {
        // The dialog answers 16:30 in device time
        const picked = new Date(2026, 9, 29, 16, 30);
        expect(withPickedTime(NOW, picked)).toBe(
            Date.parse("2026-10-29T15:30:00Z"),
        );
    });

    it("keeps the Budapest time of day when the date changes", () => {
        const picked = new Date(Date.UTC(2026, 10, 2));
        expect(withPickedDate(NOW, picked)).toBe(
            Date.parse("2026-11-02T13:05:00Z"),
        );
    });

    it("uses the Budapest day after midnight there", () => {
        // 00:30 in Budapest, still the 29th in London and UTC
        const late = Date.parse("2026-10-29T23:30:00Z");
        expect(dateDialogDate(late).toISOString()).toBe(
            "2026-10-30T00:00:00.000Z",
        );
        expect(budapestToday(late).getDate()).toBe(30);
    });
});
