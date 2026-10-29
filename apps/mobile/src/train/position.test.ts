import type { VehiclePositionWithDelay } from "@megisholavonat/api-client";
import { describe, expect, it } from "vitest";
import {
    haversineMeters,
    placeLabel,
    railPosition,
    speedKmh,
} from "./position";

const now = new Date("2026-08-14T08:00:00Z");
const nowS = now.getTime() / 1000;

// A, B and C are 0.1° of latitude apart (about 11.1 km)
const A = { name: "A", lat: 47.0, lon: 19 };
const B = { name: "B", lat: 47.1, lon: 19 };
const C = { name: "C", lat: 47.2, lon: 19 };
const segment = haversineMeters(A, B);

function details(
    last: number | null,
    next: number | null,
    progress: number,
    extra: { speed?: number | null; lastUpdated?: number } = {},
) {
    return {
        speed: extra.speed ?? null,
        lastUpdated: extra.lastUpdated ?? nowS,
        vehicleProgress: {
            lastStop: "",
            nextStop: "",
            lastStopIndex: last,
            nextStopIndex: next,
            progress,
        },
        trip: { stoptimes: [A, B, C].map((stop) => ({ stop })) },
    } as unknown as VehiclePositionWithDelay;
}

describe("railPosition", () => {
    it("places the train proportionally between two stops", () => {
        expect(railPosition(details(0, 1, 0.25), now)).toEqual({
            from: 0,
            to: 1,
            fraction: 0.25,
        });
    });

    it("clamps progress to the segment", () => {
        expect(railPosition(details(0, 1, 1.4), now)?.fraction).toBe(1);
        expect(railPosition(details(0, 1, -0.2), now)?.fraction).toBe(0);
    });

    it("puts a train standing at a stop on its dot", () => {
        expect(railPosition(details(0, 0, 0), now)).toEqual({
            from: 0,
            to: 0,
            fraction: 0,
        });
    });

    it("has no position without stop indices or with odd ones", () => {
        expect(railPosition(details(null, 1, 0.5), now)).toBeNull();
        expect(railPosition(details(2, 1, 0.5), now)).toBeNull();
        expect(railPosition(details(1, 5, 0.5), now)).toBeNull();
    });

    it("glides on at the last speed (m/s, as the API sends it)", () => {
        // 30 m/s (108 km/h) for 20 s = 600 m of track
        const d = details(0, 1, 0.1, { speed: 30, lastUpdated: nowS - 20 });
        expect(railPosition(d, now, true)?.fraction).toBeCloseTo(
            0.1 + 600 / (segment * 1.2),
            5,
        );
        // Without extrapolation it stays at the reported progress
        expect(railPosition(d, now, false)?.fraction).toBe(0.1);
    });

    it("never glides into the next stop or for too long", () => {
        const fast = details(0, 1, 0.9, { speed: 44, lastUpdated: nowS - 60 });
        expect(railPosition(fast, now, true)?.fraction).toBe(0.95);
        // Already reported past 0.95: kept, not pulled back
        const close = details(0, 1, 0.98, { speed: 14 });
        expect(railPosition(close, now, true)?.fraction).toBe(0.98);
        // 10 m/s, for at most 90 s
        const old = details(0, 1, 0, { speed: 10, lastUpdated: nowS - 3600 });
        expect(railPosition(old, now, true)?.fraction).toBeCloseTo(
            900 / (segment * 1.2),
            5,
        );
    });

    it("puts a train waiting out a stop, at its origin or arrived on its dot", () => {
        const at = (extra: object) =>
            railPosition({ ...details(1, 2, 0.1), ...extra }, now, true);
        expect(at({ dwellStopIndex: 1 })).toEqual({
            from: 1,
            to: 1,
            fraction: 0,
        });
        expect(at({ activity: "beforeDeparture" })).toMatchObject({
            from: 0,
            to: 0,
        });
        expect(at({ activity: "arrived" })).toMatchObject({ from: 2, to: 2 });
    });

    it("doesn't glide a standing train", () => {
        const d = details(0, 1, 0.3, { speed: 0, lastUpdated: nowS - 30 });
        expect(railPosition(d, now, true)?.fraction).toBe(0.3);
    });
});

describe("speedKmh", () => {
    it("labels the API's m/s in km/h", () => {
        expect(speedKmh(33.3)).toBe(120);
        expect(speedKmh(0)).toBe(0);
    });
});

describe("haversineMeters", () => {
    it("measures 0.1° of latitude as about 11.1 km", () => {
        expect(segment).toBeGreaterThan(11_000);
        expect(segment).toBeLessThan(11_200);
    });
});

describe("placeLabel", () => {
    it("says just past the last stop in the first half", () => {
        expect(placeLabel({ from: 0, to: 1, fraction: 0.3 }, 80)).toEqual({
            kind: "after",
            stop: 0,
        });
    });

    it("says nearing the next stop in the second half", () => {
        expect(placeLabel({ from: 0, to: 1, fraction: 0.7 }, 80)).toEqual({
            kind: "before",
            stop: 1,
        });
    });

    it("says standing at a stop when stopped next to it", () => {
        expect(placeLabel({ from: 0, to: 1, fraction: 0.02 }, 0)).toEqual({
            kind: "at",
            stop: 0,
        });
        expect(placeLabel({ from: 0, to: 1, fraction: 0.99 }, null)).toEqual({
            kind: "at",
            stop: 1,
        });
        expect(placeLabel({ from: 2, to: 2, fraction: 0 }, 0)).toEqual({
            kind: "at",
            stop: 2,
        });
    });

    it("keeps between stops for a train stopped on open line", () => {
        expect(placeLabel({ from: 0, to: 1, fraction: 0.5 }, 0)).toEqual({
            kind: "before",
            stop: 1,
        });
    });
});
