import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings, shouldAskConsent } from "./settings";

describe("parseSettings", () => {
    it("defaults dynamic colour to off", () => {
        expect(parseSettings(null).dynamicColor).toBe(false);
    });

    it("keeps valid stored values", () => {
        const stored = {
            language: "en",
            theme: "dark",
            dynamicColor: true,
            railwayLayer: false,
            analytics: "granted",
            launchCount: 3,
            openedTrain: true,
        };
        expect(parseSettings(JSON.stringify(stored))).toEqual(stored);
    });

    it("falls back field by field", () => {
        const parsed = parseSettings(
            JSON.stringify({ language: "de", theme: 3, launchCount: -1 }),
        );
        expect(parsed).toEqual(DEFAULT_SETTINGS);
    });

    it("survives corrupt JSON", () => {
        expect(parseSettings("{not json")).toEqual(DEFAULT_SETTINGS);
        expect(parseSettings("[1,2]")).toEqual(DEFAULT_SETTINGS);
    });
});

describe("shouldAskConsent", () => {
    const asked = { ...DEFAULT_SETTINGS, launchCount: 2, openedTrain: true };

    it("asks on the second launch after a train was opened", () => {
        expect(shouldAskConsent(asked, false)).toBe(true);
    });

    it("waits for the second launch and an opened train", () => {
        expect(shouldAskConsent({ ...asked, launchCount: 1 }, false)).toBe(
            false,
        );
        expect(shouldAskConsent({ ...asked, openedTrain: false }, false)).toBe(
            false,
        );
    });

    it("never asks again once answered", () => {
        expect(shouldAskConsent({ ...asked, analytics: "denied" }, false)).toBe(
            false,
        );
        expect(
            shouldAskConsent({ ...asked, analytics: "granted" }, false),
        ).toBe(false);
    });

    it("never asks on a launch from a link or notification", () => {
        expect(shouldAskConsent(asked, true)).toBe(false);
    });
});
