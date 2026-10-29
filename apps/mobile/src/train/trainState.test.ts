import type {
    TrainFeatureCollection,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";
import { trainDisplay } from "@megisholavonat/core/display";
import { describe, expect, it } from "vitest";
import { patchFeed } from "./trainState";

const now = new Date("2026-08-14T08:00:00Z");
const ago = (s: number) => Math.floor(now.getTime() / 1000) - s;

describe("patchFeed", () => {
    const feature = (
        vehicleId: string,
        lastUpdated: number,
        activity: string | null = "running",
    ) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [19, 47] },
        properties: {
            vehicleId,
            lat: 47,
            lon: 19,
            delay: 4,
            lastUpdated,
            activity,
        },
    });
    const feed = (...features: ReturnType<typeof feature>[]) =>
        ({ features }) as unknown as TrainFeatureCollection;
    const fresh = {
        vehicleId: "1:1",
        lat: 47.5,
        lon: 19.5,
        delay: 23,
        lastUpdated: ago(5),
        activity: "running",
    } as VehiclePositionWithDelay;

    it("brings the open train up to date from newer details", () => {
        const patched = patchFeed(
            feed(feature("1:1", ago(70)), feature("1:2", ago(70))),
            fresh,
        );
        expect(patched?.features[0]?.properties).toMatchObject({
            delay: 23,
            lastUpdated: ago(5),
            lat: 47.5,
            lon: 19.5,
        });
        expect(patched?.features[0]?.geometry).toEqual({
            type: "Point",
            coordinates: [19.5, 47.5],
        });
        expect(patched?.features[1]?.properties.delay).toBe(4);
    });

    it("keeps the feed when its data is as new", () => {
        const current = feed(feature("1:1", ago(5)));
        expect(patchFeed(current, fresh)).toBe(current);
        const other = feed(feature("1:9", ago(70)));
        expect(patchFeed(other, fresh)).toBe(other);
    });

    it("makes the marker and the sheet agree", () => {
        const arrived = { ...fresh, activity: "arrived" } as const;
        const patched = patchFeed(feed(feature("1:1", ago(70))), arrived);
        const marker = patched?.features[0]?.properties;
        if (!marker) throw new Error("no feature");
        expect(trainDisplay(marker, now)).toEqual(trainDisplay(arrived, now));
        expect(trainDisplay(marker, now).state).toBe("idle");
    });
});
