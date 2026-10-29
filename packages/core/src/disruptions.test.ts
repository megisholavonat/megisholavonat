import type { Disruption } from "@megisholavonat/api-client";
import { describe, expect, it } from "vitest";
import {
    affectsInterests,
    affectsStation,
    affectsTrain,
    disruptionLines,
    isDisruptionActive,
    sortDisruptions,
} from "./disruptions";

const MANDOK = "005515875";
const TORNYOSPALCA = "005515883";
const ZAHONY = "005514175";

function disruption(over: Partial<Disruption> = {}): Disruption {
    return {
        id: "a",
        alertIds: ["a"],
        effect: "replacement_bus",
        cause: "other",
        severity: "high",
        scope: "line",
        segment: {
            fromName: "Mándok",
            toName: "Tornyospálca",
            fromId: MANDOK,
            toId: TORNYOSPALCA,
        },
        title: "Pótlóbusz Mándok és Tornyospálca között",
        description: "Mándok és Tornyospálca között pótlóbusz közlekedik.",
        details: [],
        url: "https://www.mavcsoport.hu/mavinform",
        start: 100,
        end: 200,
        lines: [],
        routes: [],
        stations: [{ id: ZAHONY, name: "Záhony" }],
        trips: [{ tripId: "1:36810", tripShortName: "36810 személyvonat" }],
        ...over,
    };
}

describe("affectsTrain", () => {
    it("matches a listed trip", () => {
        expect(
            affectsTrain(disruption(), { tripId: "1:36810", stationIds: [] }),
        ).toBe(true);
    });

    it("matches the train number of another day's trip", () => {
        expect(
            affectsTrain(disruption(), {
                tripId: "1:99",
                tripShortName: "36810 személyvonat",
                stationIds: [],
            }),
        ).toBe(true);
    });

    it("matches a train calling at both ends of the stretch", () => {
        const train = { tripId: "1:1", stationIds: [MANDOK, TORNYOSPALCA] };
        expect(affectsTrain(disruption(), train)).toBe(true);
        expect(
            affectsTrain(disruption(), { tripId: "1:1", stationIds: [MANDOK] }),
        ).toBe(false);
    });
});

describe("affectsStation", () => {
    it("counts listed stations and the stretch ends", () => {
        expect(affectsStation(disruption(), ZAHONY)).toBe(true);
        expect(affectsStation(disruption(), MANDOK)).toBe(true);
        expect(affectsStation(disruption(), "005510009")).toBe(false);
    });
});

describe("sortDisruptions", () => {
    it("puts the user's trains first, then severity, then newest", () => {
        const low = disruption({
            id: "low",
            severity: "low",
            segment: null,
            stations: [],
            trips: [{ tripId: "1:2", tripShortName: "2909" }],
        });
        const older = disruption({ id: "older", start: 50 });
        const newer = disruption({ id: "newer", start: 150 });

        const sorted = sortDisruptions(
            [older, low, newer],
            [{ trainNumber: "2909" }],
        );

        expect(sorted.map((s) => s.disruption.id)).toEqual([
            "low",
            "newer",
            "older",
        ]);
        expect(sorted.map((s) => s.mine)).toEqual([true, false, false]);
    });

    it("counts a followed boarding station", () => {
        expect(
            affectsInterests(disruption(), [{ stationIds: [null, ZAHONY] }]),
        ).toBe(true);
        expect(affectsInterests(disruption(), [])).toBe(false);
    });
});

describe("helpers", () => {
    it("checks validity", () => {
        expect(isDisruptionActive(disruption(), 150)).toBe(true);
        expect(isDisruptionActive(disruption(), 250)).toBe(false);
        expect(isDisruptionActive(disruption({ end: null }), 250)).toBe(true);
    });

    it("caps the line glyphs", () => {
        const lines = ["S50", "S51", "G43", "H8", "H9"].map((name) => ({
            shortName: "<span>A</span>",
            name,
        }));
        const { lines: shown, more } = disruptionLines(
            disruption({ lines }),
            3,
        );
        expect(shown).toHaveLength(3);
        expect(more).toBe(2);
    });
});
