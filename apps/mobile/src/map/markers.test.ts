import type { TrainFeatureCollection } from "@megisholavonat/api-client";
import { darkTheme, lightTheme } from "@megisholavonat/core/tokens/native";
import { describe, expect, it } from "vitest";
import { fittedRadius, markerCollection } from "./markers";

const now = new Date("2026-08-14T08:00:00Z");
const nowS = now.getTime() / 1000;

function feed(
    ...trains: { id: string; delay: number; ago: number; isStale?: boolean }[]
): TrainFeatureCollection {
    return {
        timestamp: now.toISOString(),
        features: trains.map((t) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [19, 47] },
            properties: {
                type: "train",
                vehicleId: t.id,
                lat: 47,
                lon: 19,
                tripShortName: "10",
                routeShortName: "",
                routeTextColor: "000000",
                delay: t.delay,
                lastUpdated: nowS - t.ago,
                isStale: t.isStale,
            },
        })) as TrainFeatureCollection["features"],
    };
}

describe("markerCollection", () => {
    it("colours by delay level and labels delays with +N", () => {
        const fc = markerCollection(
            feed(
                { id: "a", delay: 2, ago: 10 },
                { id: "b", delay: 23, ago: 10 },
                { id: "c", delay: 74, ago: 10 },
            ),
            lightTheme,
            now,
        );
        const [a, b, c] = fc.features.map((f) => f.properties);
        expect(a).toMatchObject({ fill: "#1A6CCF", label: "", sort: 1 });
        expect(a?.halo).toBe("rgba(20,22,26,0.45)");
        expect(b).toMatchObject({
            fill: "#E5660B",
            label: "+23",
            labelColor: "#14161A",
            stroke: "#14161A",
            halo: "",
        });
        expect(c).toMatchObject({ fill: "#C41E16", label: "+74", sort: 4 });
    });

    it("greys stale trains with the minutes since the update and hides old ones", () => {
        const fc = markerCollection(
            feed(
                { id: "stale", delay: 23, ago: 7 * 60 },
                { id: "flagged", delay: 0, ago: 60, isStale: true },
                { id: "gone", delay: 0, ago: 31 * 60 },
            ),
            darkTheme,
            now,
        );
        expect(fc.features.map((f) => f.properties.vehicleId)).toEqual([
            "stale",
            "flagged",
        ]);
        expect(fc.features[0]?.properties).toMatchObject({
            label: "7′",
            fill: darkTheme.stale.background,
            labelColor: darkTheme.stale.text,
            sort: 0,
        });
    });

    it("sizes dots by severity", () => {
        const fc = markerCollection(
            feed(
                { id: "a", delay: 0, ago: 0 },
                { id: "b", delay: 7, ago: 0 },
                { id: "c", delay: 20, ago: 0 },
                { id: "d", delay: 90, ago: 0 },
            ),
            lightTheme,
            now,
        );
        expect(fc.features.map((f) => f.properties.dotRadius)).toEqual([
            4, 5, 6, 7,
        ]);
    });
});

describe("fittedRadius", () => {
    it("is half the pill height for short or no labels", () => {
        expect(fittedRadius("", 0, 16)).toBe(8);
        expect(fittedRadius("+7", 12, 22)).toBe(11);
    });

    it("grows for longer labels", () => {
        expect(fittedRadius("+123", 14, 26)).toBeGreaterThan(13);
    });
});
