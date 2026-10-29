import { describe, expect, it } from "vitest";
import {
    flyToPlace,
    flyToTrain,
    getMapFocus,
    noteMapTap,
    setFocusStation,
    setSheet,
    TRAIN_FLY_ZOOM,
    takeMapTap,
} from "./focus";

describe("map focus", () => {
    it("pads for the topmost open sheet", () => {
        setSheet("station", 0.6);
        setSheet("train", 0.22);
        expect(getMapFocus().sheet).toBe(0.22);
        // Dragged to half: stays on top
        setSheet("station", 1);
        setSheet("train", 0.5);
        expect(getMapFocus().sheet).toBe(0.5);
        setSheet("train", null);
        expect(getMapFocus().sheet).toBe(1);
        setSheet("station", null);
        expect(getMapFocus().sheet).toBeNull();
    });

    it("gives every flight its own key, so the same place flies twice", () => {
        flyToPlace(19, 47.5, 13);
        const first = getMapFocus().fly;
        flyToPlace(19, 47.5, 13);
        const second = getMapFocus().fly;
        expect(first?.key).not.toBe(second?.key);
        flyToTrain("v1");
        expect(getMapFocus().fly).toMatchObject({
            kind: "train",
            vehicleId: "v1",
            zoom: TRAIN_FLY_ZOOM,
        });
    });

    it("doesn't fly to a train tapped on the map", () => {
        noteMapTap("v1");
        expect(takeMapTap("v2")).toBe(false);
        noteMapTap("v1");
        expect(takeMapTap("v1")).toBe(true);
        expect(takeMapTap("v1")).toBe(false);
    });

    it("keeps the same station object for the same station", () => {
        const keleti = { id: "1", name: "Keleti", lat: 47.5, lon: 19.08 };
        setFocusStation(keleti);
        setFocusStation({ ...keleti });
        expect(getMapFocus().station).toBe(keleti);
        setFocusStation(null);
        expect(getMapFocus().station).toBeNull();
    });
});
