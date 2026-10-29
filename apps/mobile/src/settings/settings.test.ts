import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings, shouldAskConsent } from "./settings";

describe("parseSettings", () => {
    it("defaults dynamic colour to off", () => {
        expect(parseSettings(null).dynamicColor).toBe(false);
    });

    it("leaves the detailed railway map off by default", () => {
        expect(parseSettings(null).detailedRailwayMap).toBe(false);
        expect(
            parseSettings(JSON.stringify({ detailedRailwayMap: true }))
                .detailedRailwayMap,
        ).toBe(true);
    });

    it("turns the overlay off for installs that stored the old default", () => {
        expect(
            parseSettings(JSON.stringify({ railwayLayer: true }))
                .detailedRailwayMap,
        ).toBe(false);
    });

    it("keeps valid stored values", () => {
        const stored = {
            language: "en",
            theme: "dark",
            dynamicColor: true,
            detailedRailwayMap: true,
            showStationNames: false,
            stationNamesOpacity: 0.45,
            animateVehicles: false,
            showTrains: false,
            showHev: true,
            showTramTrains: false,
            analytics: "granted",
            launchCount: 3,
            openedTrain: true,
        };
        expect(parseSettings(JSON.stringify(stored))).toEqual(stored);
    });

    it("shows every vehicle, station names and animation by default", () => {
        const d = parseSettings(null);
        expect(d.showTrains && d.showHev && d.showTramTrains).toBe(true);
        expect(d.showStationNames).toBe(true);
        expect(d.stationNamesOpacity).toBe(1);
        expect(d.animateVehicles).toBe(true);
    });

    it("keeps the names' opacity on the slider", () => {
        const opacity = (value: unknown) =>
            parseSettings(JSON.stringify({ stationNamesOpacity: value }))
                .stationNamesOpacity;
        expect(opacity(0.42)).toBe(0.4);
        expect(opacity(0)).toBe(0.05);
        expect(opacity(3)).toBe(1);
        expect(opacity("0.5")).toBe(1);
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
