import { describe, expect, it } from "vitest";
import { DELAY_COLORS, getDelayLevel, NO_DATA_COLOR } from "./delay";

describe("getDelayLevel", () => {
    it.each([
        [-3, "onTime"],
        [0, "onTime"],
        [4.99, "onTime"],
        [5, "slight"],
        [14.99, "slight"],
        [15, "moderate"],
        [59.99, "moderate"],
        [60, "severe"],
        [600, "severe"],
    ] as const)("classifies %d minutes as %s", (minutes, level) => {
        expect(getDelayLevel(minutes)).toBe(level);
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
