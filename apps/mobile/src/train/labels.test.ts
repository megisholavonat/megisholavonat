import { describe, expect, it } from "vitest";
import { routeLabel, splitTripName } from "./labels";

describe("routeLabel", () => {
    it("maps an MNR2007 entity to its glyph and route name", () => {
        expect(routeLabel('<span class="MNR2007">&#403;</span>')).toEqual({
            kind: "glyph",
            glyph: String.fromCodePoint(403),
            name: "IR1",
        });
    });

    it("accepts hex entities", () => {
        const label = routeLabel('<span class="MNR2007">&#x193;</span>');
        expect(label).toMatchObject({ kind: "glyph", name: "IR1" });
    });

    it("keeps plain-text route names as text", () => {
        expect(routeLabel("H5")).toEqual({ kind: "text", text: "H5" });
    });

    it("returns null for empty input", () => {
        expect(routeLabel("")).toBeNull();
        expect(routeLabel(null)).toBeNull();
    });
});

describe("splitTripName", () => {
    it("separates the train number from its name", () => {
        expect(splitTripName("6248 személyvonat")).toEqual({
            number: "6248",
            name: "személyvonat",
        });
    });

    it("keeps names without a leading number intact", () => {
        expect(splitTripName("Tokaj InterCity")).toEqual({
            number: null,
            name: "Tokaj InterCity",
        });
    });
});
