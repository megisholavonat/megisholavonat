import { describe, expect, it } from "vitest";
import {
    DELAY_COLORS,
    getDelayLevel,
    LEVEL_FROM_MIN,
    NO_DATA_COLOR,
    roundMinutes,
    secondsToMinutes,
    signedDelay,
} from "./delay";

describe("getDelayLevel", () => {
    it.each([
        [-3, "onTime"],
        [0, "onTime"],
        [4.99, "onTime"],
        // Up to and including +5 is on time, everywhere
        [5, "onTime"],
        [5.49, "onTime"],
        [5.5, "slight"],
        [6, "slight"],
        [14.49, "slight"],
        [14.5, "moderate"],
        [15, "moderate"],
        [59.49, "moderate"],
        [59.5, "severe"],
        [60, "severe"],
        [600, "severe"],
    ] as const)("classifies %d minutes as %s", (minutes, level) => {
        expect(getDelayLevel(minutes)).toBe(level);
    });

    it("starts each level at the minute the legend shows", () => {
        expect(LEVEL_FROM_MIN).toEqual({
            onTime: 0,
            slight: 6,
            moderate: 15,
            severe: 60,
        });
        for (const [level, from] of Object.entries(LEVEL_FROM_MIN)) {
            expect(getDelayLevel(from)).toBe(level);
        }
    });
});

describe("rounding", () => {
    it("rounds half up", () => {
        expect(roundMinutes(2.5)).toBe(3);
        expect(roundMinutes(2.49)).toBe(2);
        expect(roundMinutes(-2.5)).toBe(-2);
        expect(roundMinutes(-2.51)).toBe(-3);
    });

    it("turns seconds into whole minutes half up, unlike banker's rounding", () => {
        expect(secondsToMinutes(150)).toBe(3);
        expect(secondsToMinutes(149)).toBe(2);
        expect(secondsToMinutes(270)).toBe(5);
        expect(secondsToMinutes(330)).toBe(6);
        expect(secondsToMinutes(-90)).toBe(-1);
    });
});

describe("signedDelay", () => {
    it("signs whole minutes with a true minus", () => {
        expect(signedDelay(7)).toBe("+7");
        expect(signedDelay(0)).toBe("0");
        expect(signedDelay(-2)).toBe("−2");
        expect(signedDelay(3.6)).toBe("+4");
        expect(signedDelay(-0.4)).toBe("0");
    });
});

describe("DELAY_COLORS", () => {
    it("uses the design-system light fills", () => {
        expect(DELAY_COLORS).toEqual({
            onTime: "#1A6CCF",
            slight: "#F2C230",
            moderate: "#E5660B",
            severe: "#C41E16",
        });
        expect(NO_DATA_COLOR).toBe("#9AA0A8");
    });
});
