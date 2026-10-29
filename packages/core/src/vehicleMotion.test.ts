import { describe, expect, it } from "vitest";
import { withDetails } from "./display";
import type { VehicleState } from "./VehicleTracker";
import {
    bearingDelta,
    GLIDE_MS,
    type Glide,
    hasMoved,
    lerpBearing,
    syncTrackers,
    vehicleFrame,
} from "./vehicleMotion";

/** Google polyline encoding of [lat, lon] pairs (precision 5) */
function encodePolyline(points: [number, number][]): string {
    let out = "";
    let prevLat = 0;
    let prevLon = 0;
    const encode = (value: number) => {
        let v = value < 0 ? ~(value << 1) : value << 1;
        while (v >= 0x20) {
            out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
            v >>= 5;
        }
        out += String.fromCharCode(v + 63);
    };
    for (const [lat, lon] of points) {
        const la = Math.round(lat * 1e5);
        const lo = Math.round(lon * 1e5);
        encode(la - prevLat);
        encode(lo - prevLon);
        prevLat = la;
        prevLon = lo;
    }
    return out;
}

const ROUTE: [number, number][] = [
    [19.0835, 47.5003],
    [19.1102, 47.5068],
    [19.1531, 47.5124],
];

describe("bearings", () => {
    it("measures and turns the short way round", () => {
        expect(bearingDelta(350, 10)).toBe(20);
        expect(bearingDelta(10, 350)).toBe(20);
        expect(lerpBearing(350, 10, 0.5)).toBe(360);
        expect(lerpBearing(10, 350, 0.5)).toBe(0);
    });

    it("counts tiny moves as still", () => {
        expect(hasMoved(undefined, [0, 0, 0])).toBe(true);
        expect(hasMoved([19, 47, 10], [19, 47, 10.2])).toBe(false);
        expect(hasMoved([19, 47, 10], [19.0001, 47, 10])).toBe(true);
        expect(hasMoved([19, 47, 10], [19, 47, 12])).toBe(true);
    });
});

describe("syncTrackers", () => {
    it("tracks the feed and drops trains that left it", () => {
        const trackers = new Map<string, VehicleState>();
        const routes = new Map<string, string>();
        const polyline = encodePolyline(ROUTE.map(([lon, lat]) => [lat, lon]));
        const jobs = syncTrackers(trackers, routes, [
            { vehicleId: "a", lon: 19.1, lat: 47.5, speed: 20 },
            {
                vehicleId: "b",
                lon: 19.11,
                lat: 47.507,
                speed: 10,
                routePolyline: polyline,
                distanceToNextStop: 2,
            },
        ]);
        expect([...trackers.keys()]).toEqual(["a", "b"]);
        expect(trackers.get("a")?.speedKmh).toBe(72);
        // The route is decoded by its job, later
        expect(jobs).toHaveLength(1);
        expect(trackers.get("b")?.route).toBeNull();
        for (const job of jobs) job();
        expect(trackers.get("b")?.route?.coords).toHaveLength(3);
        expect(routes.get("b")).toBe(polyline);

        // Same route again: nothing to decode; "a" is gone
        const again = syncTrackers(trackers, routes, [
            {
                vehicleId: "b",
                lon: 19.12,
                lat: 47.508,
                routePolyline: polyline,
            },
        ]);
        expect(again).toHaveLength(0);
        expect([...trackers.keys()]).toEqual(["b"]);
    });
});

describe("vehicleFrame", () => {
    function tracked(lon: number, lat: number): VehicleState {
        const trackers = new Map<string, VehicleState>();
        syncTrackers(trackers, new Map(), [
            { vehicleId: "a", lon, lat, heading: 90 },
        ]);
        const state = trackers.get("a");
        if (!state) throw new Error("no tracker");
        return state;
    }

    it("glides a fresh position in, then lands on it", () => {
        const state = tracked(19.1, 47.5);
        const glides = new Map<string, Glide>();
        const args = { advance: true, glides, id: "a" };
        const from: [number, number, number] = [19.099, 47.5, 90];
        const start = vehicleFrame(state, 1000, {
            ...args,
            fresh: true,
            prev: from,
        });
        expect(start[0]).toBeCloseTo(19.099, 6);
        const mid = vehicleFrame(state, 1000 + GLIDE_MS / 2, {
            ...args,
            fresh: false,
            prev: start,
        });
        expect(mid[0]).toBeGreaterThan(19.099);
        expect(mid[0]).toBeLessThan(19.1);
        const end = vehicleFrame(state, 1000 + GLIDE_MS, {
            ...args,
            fresh: false,
            prev: mid,
        });
        expect(end[0]).toBe(19.1);
        expect(glides.size).toBe(0);
    });

    it("jumps far moves and snaps moves below the glide threshold", () => {
        const state = tracked(19.1, 47.5);
        const glides = new Map<string, Glide>();
        const far = vehicleFrame(state, 0, {
            advance: false,
            fresh: true,
            prev: [18, 47, 0],
            glides,
            id: "a",
        });
        expect(far[0]).toBe(19.1);
        const near = vehicleFrame(state, 0, {
            advance: false,
            fresh: true,
            prev: [19.09999, 47.5, 90],
            glides,
            id: "a",
            minGlideDeg: 0.001,
        });
        expect(near[0]).toBe(19.1);
        expect(glides.size).toBe(0);
    });
});

describe("withDetails", () => {
    const props = {
        vehicleId: "a",
        delay: 2,
        lastUpdated: 100,
        activity: "running" as const,
    };

    it("takes the fresher details of the same train", () => {
        expect(
            withDetails(props, {
                vehicleId: "a",
                delay: 7,
                lastUpdated: 120,
                activity: null,
            }),
        ).toEqual({ ...props, delay: 7, lastUpdated: 120 });
    });

    it("keeps the list entry for older or other details", () => {
        const older = {
            vehicleId: "a",
            delay: 7,
            lastUpdated: 90,
            activity: null,
        };
        expect(withDetails(props, older)).toBe(props);
        expect(withDetails(props, { ...older, vehicleId: "b" })).toBe(props);
        expect(withDetails(props, undefined)).toBe(props);
    });
});
