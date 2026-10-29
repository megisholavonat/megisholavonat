import type { Shown } from "@megisholavonat/core/vehicleMotion";
import { describe, expect, it } from "vitest";
import { collectionJson, featureJsonCache } from "./vehicleJson";

function collection(...ids: string[]) {
    return {
        type: "FeatureCollection" as const,
        features: ids.map((id, i) => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [19 + i, 47] },
            properties: { vehicleId: id, heading: 0 },
        })),
    };
}

describe("collectionJson", () => {
    it("draws trains where the feed puts them without the animation", () => {
        const fc = collection("a", "b");
        expect(
            JSON.parse(collectionJson(fc, null, featureJsonCache())),
        ).toEqual(fc);
    });

    it("moves animated trains and turns them with their heading", () => {
        const fc = collection("a", "b");
        const shown = new Map<string, Shown>([["a", [19.5, 47.25, 90]]]);
        const out = JSON.parse(collectionJson(fc, shown, featureJsonCache()));
        expect(out.features[0].geometry.coordinates).toEqual([19.5, 47.25]);
        expect(out.features[0].properties.heading).toBe(90);
        expect(out.features[1]).toEqual(fc.features[1]);
    });

    it("re-serialises only the trains that moved", () => {
        const fc = collection("a", "b");
        const cache = featureJsonCache();
        const shown = new Map<string, Shown>([
            ["a", [19, 47, 0]],
            ["b", [20, 47, 0]],
        ]);
        collectionJson(fc, shown, cache);
        const before = new Map(
            fc.features.map((f) => [
                f,
                (cache.get(f) as { json: string }).json,
            ]),
        );
        shown.set("a", [19.1, 47, 0]);
        collectionJson(fc, shown, cache);
        const [a, b] = fc.features;
        expect(cache.get(a)?.json).not.toBe(before.get(a));
        // Same string instance: not serialised again
        expect(cache.get(b)?.json).toBe(before.get(b));
    });
});
