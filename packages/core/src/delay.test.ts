import { describe, expect, it } from "vitest";
import { DELAY_COLORS, getDelayLevel } from "./delay";

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
    it("keeps the map colours", () => {
        expect(DELAY_COLORS).toEqual({
            onTime: "#4AD94A",
            slight: "#E4DE3A",
            moderate: "#DF9227",
            severe: "#D9564A",
        });
    });
});
