import type {
    TrainFeatureCollection,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";
import { trainDisplay } from "@megisholavonat/core/display";
import { describe, expect, it } from "vitest";
import { shownDisplay } from "./delayDisplay";
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

    it("agrees on an early train only when the API says it stands at a stop", () => {
        // 2 min early, 0 km/h, the same position update as the feed
        const stopped = { ...fresh, delay: -2, speed: 0, lastUpdated: ago(70) };
        const dwelling = { ...stopped, dwellStopIndex: 3 };
        const list = () => feed(feature("1:1", ago(70)));

        // Stopped at a signal: early on both, the feed is left as it is
        const unchanged = list();
        expect(patchFeed(unchanged, stopped)).toBe(unchanged);
        const plain = unchanged.features[0]?.properties;
        if (!plain) throw new Error("no feature");
        expect(shownDisplay({ ...plain, delay: -2 }, now).delay).toBe(-2);
        expect(shownDisplay(stopped, now).delay).toBe(-2);

        // Standing at a stop: the same-age details bring the dwell along
        const marker = patchFeed(list(), dwelling)?.features[0]?.properties;
        if (!marker) throw new Error("no feature");
        expect(shownDisplay(marker, now)).toEqual(shownDisplay(dwelling, now));
        expect(shownDisplay(marker, now).delay).toBe(0);
    });
});
