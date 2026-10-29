import { describe, expect, it } from "vitest";
import { minutesSinceUpdate, staleness } from "./stale";

describe("staleness", () => {
    const now = new Date("2026-08-14T08:00:00Z");
    const ago = (seconds: number) => now.getTime() / 1000 - seconds;

    it.each([
        [0, "fresh"],
        [300, "fresh"],
        [301, "stale"],
        [1800, "stale"],
        [1801, "hidden"],
    ] as const)("is %s seconds old: %s", (seconds, expected) => {
        expect(staleness(ago(seconds), now)).toBe(expected);
    });
});

describe("minutesSinceUpdate", () => {
    const now = new Date("2026-08-14T08:00:00Z");

    it("floors to whole minutes", () => {
        expect(minutesSinceUpdate(now.getTime() / 1000 - 419, now)).toBe(6);
    });

    it("is never negative for clock skew", () => {
        expect(minutesSinceUpdate(now.getTime() / 1000 + 30, now)).toBe(0);
    });
});
