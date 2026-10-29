import { describe, expect, it } from "vitest";
import { baseStyleUrl, markerPaint, railwayTileUrl } from "./mapStyle";

describe("map style", () => {
    it("uses the web's OpenFreeMap styles per colour scheme", () => {
        expect(baseStyleUrl("light")).toBe(
            "https://tiles.openfreemap.org/styles/liberty",
        );
        expect(baseStyleUrl("dark")).toBe(
            "https://tiles.openfreemap.org/styles/dark",
        );
    });

    it("routes railway tiles through the tile cache when configured", () => {
        expect(railwayTileUrl("https://tc.megisholavonat.info/")).toBe(
            "https://tc.megisholavonat.info/orm/{z}/{x}/{y}.png",
        );
        expect(railwayTileUrl()).toContain("tiles.openrailwaymap.org");
    });

    it("fades the other markers while one is selected", () => {
        expect(markerPaint(null)?.["circle-opacity"]).toBe(1);
        expect(markerPaint("1:42")?.["circle-opacity"]).toEqual([
            "case",
            ["==", ["get", "vehicleId"], "1:42"],
            1,
            0.6,
        ]);
    });
});
