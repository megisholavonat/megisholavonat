import type { TrainFeatureCollection } from "@megisholavonat/api-client";
import { DELAY_SCALE, STALE_COLORS } from "@megisholavonat/core/tokens";
import { describe, expect, it } from "vitest";
import { markerCollection, markShape, VEHICLE_SHAPES } from "./markers";

const now = new Date("2026-08-14T08:00:00Z");
const nowS = now.getTime() / 1000;

function feed(
    ...trains: {
        id: string;
        delay: number;
        ago: number;
        isStale?: boolean;
        type?: "train" | "hev" | "tramtrain";
    }[]
): TrainFeatureCollection {
    return {
        timestamp: now.toISOString(),
        features: trains.map((t) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [19, 47] },
            properties: {
                type: t.type ?? "train",
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
    it("marks followed trains and draws them on top", () => {
        const fc = markerCollection(
            feed(
                { id: "a", delay: 2, ago: 10 },
                { id: "b", delay: 2, ago: 10 },
            ),
            "light",
            now,
            new Set(["b"]),
        );
        const [a, b] = fc.features.map((f) => f.properties);
        expect(a).toMatchObject({ followed: false, sort: 1 });
        expect(b).toMatchObject({ followed: true, sort: 11 });
    });

    it("colours by the delay band only, with a +N for late trains", () => {
        const fc = markerCollection(
            feed(
                { id: "a", delay: 2, ago: 10 },
                { id: "b", delay: 23, ago: 10 },
                { id: "c", delay: 74, ago: 10 },
            ),
            "light",
            now,
        );
        const [a, b, c] = fc.features.map((f) => f.properties);
        expect(a).toMatchObject({
            icon: "mhav-light-onTime-train",
            text: "",
            label: "",
            chip: "",
            sort: 1,
        });
        expect(b).toMatchObject({
            icon: "mhav-light-moderate-train",
            text: "+23",
            textColor: DELAY_SCALE.light.moderate.text,
            label: "+23",
            labelColor: DELAY_SCALE.light.moderate.label,
            chip: "mhav-light-chip-moderate",
            delay: 23,
        });
        expect(c).toMatchObject({
            icon: "mhav-light-severe-train",
            text: "+74",
            sort: 4,
        });
    });

    it("gives every vehicle type its shape at the same size", () => {
        const fc = markerCollection(
            feed(
                { id: "t", delay: 0, ago: 0, type: "train" },
                { id: "h", delay: 0, ago: 0, type: "hev" },
                { id: "x", delay: 0, ago: 0, type: "tramtrain" },
            ),
            "dark",
            now,
        );
        expect(fc.features.map((f) => f.properties.icon)).toEqual([
            "mhav-dark-onTime-train",
            "mhav-dark-onTime-hev",
            "mhav-dark-onTime-tramtrain",
        ]);
        expect(fc.features.map((f) => f.properties.ring)).toEqual([
            "mhav-dark-ring-train",
            "mhav-dark-ring-hev",
            "mhav-dark-ring-tramtrain",
        ]);
    });

    it("keeps the shapes behind one switch", () => {
        expect(VEHICLE_SHAPES).toBe(true);
        expect(markShape("hev")).toBe("hev");
        expect(markShape("tramtrain")).toBe("tramtrain");
        expect(markShape(undefined)).toBe("train");
    });

    it("greys stale trains with their last delay and a ? and hides old ones", () => {
        const fc = markerCollection(
            feed(
                { id: "stale", delay: 23, ago: 7 * 60 },
                { id: "flagged", delay: 0, ago: 60, isStale: true },
                { id: "gone", delay: 0, ago: 31 * 60 },
            ),
            "dark",
            now,
        );
        expect(fc.features.map((f) => f.properties.vehicleId)).toEqual([
            "stale",
            "flagged",
        ]);
        // Old data: hollow, its last delay with a "?" (on the chip when open)
        expect(fc.features[0]?.properties).toMatchObject({
            icon: "mhav-dark-stale-train",
            label: "+23?",
            labelColor: STALE_COLORS.dark.text,
            chip: "mhav-dark-chip-stale",
            text: "+23?",
            textColor: STALE_COLORS.dark.text,
            sort: 0,
        });
        // Fresh but not running (waiting or arrived): solid grey, no label
        expect(fc.features[1]?.properties).toMatchObject({
            icon: "mhav-dark-inactive-train",
            label: "",
            chip: "",
            sort: 0,
        });
    });
});

describe("markerCollection options", () => {
    const mixed = () =>
        feed(
            { id: "t", delay: 2, ago: 10, type: "train" },
            { id: "h", delay: 2, ago: 10, type: "hev" },
            { id: "tt", delay: 2, ago: 10, type: "tramtrain" },
        );

    it("shows only the vehicle types the settings keep", () => {
        const ids = (filter: {
            train: boolean;
            hev: boolean;
            tramtrain: boolean;
        }) =>
            markerCollection(mixed(), "light", now, new Set(), {
                filter,
            }).features.map((f) => f.properties.vehicleId);
        expect(ids({ train: true, hev: true, tramtrain: true })).toEqual([
            "t",
            "h",
            "tt",
        ]);
        expect(ids({ train: false, hev: true, tramtrain: false })).toEqual([
            "h",
        ]);
    });

    it("takes the open train's fresher delay from its details", () => {
        const fc = markerCollection(
            feed({ id: "t", delay: 2, ago: 60 }),
            "light",
            now,
            new Set(),
            {
                details: {
                    vehicleId: "t",
                    delay: 23,
                    lastUpdated: nowS - 5,
                    activity: "running",
                } as never,
            },
        );
        expect(fc.features[0]?.properties).toMatchObject({
            label: "+23",
            delay: 23,
        });
    });

    it("gives moving trains a heading for the arrow, not old data", () => {
        const fc = markerCollection(
            feed(
                { id: "live", delay: 2, ago: 10 },
                { id: "old", delay: 2, ago: 7 * 60 },
            ),
            "light",
            now,
        );
        expect(fc.features.map((f) => f.properties.moving)).toEqual([
            true,
            false,
        ]);
        expect(fc.features[0]?.properties.heading).toBe(0);
    });
});
