import { DELAY_COLORS, NO_DATA_COLOR } from "@megisholavonat/core/delay";
import { describe, expect, it } from "vitest";
import { baseStyleUrl, railwayTileUrl, TRAIN_CIRCLE_PAINT } from "./mapStyle";

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

    it("colours stale trains grey and others by delay level", () => {
        const [, staleTest, staleColor, step] =
            TRAIN_CIRCLE_PAINT["circle-color"];
        expect(staleTest).toEqual(["==", ["get", "isStale"], true]);
        expect(staleColor).toBe(NO_DATA_COLOR);
        expect(step).toContain(DELAY_COLORS.onTime);
        expect(step).toContain(DELAY_COLORS.severe);
    });
});
