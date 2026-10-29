import {
    along,
    bearing,
    distance,
    length,
    lineString,
    nearestPointOnLine,
    point,
} from "@turf/turf";
import { describe, expect, it } from "vitest";
import {
    bearingDeg,
    createVehicleState,
    distanceKm,
    locateOnRoute,
    onPositionUpdate,
    pointAlong,
    routeFromPolyline,
    routeGeometry,
    setRoute,
    tick,
} from "./VehicleTracker";

// Budapest-Keleti towards Hatvan, roughly
const COORDS: [number, number][] = [
    [19.0835, 47.5003],
    [19.1102, 47.5068],
    [19.1531, 47.5124],
    [19.2093, 47.5251],
    [19.3001, 47.5532],
    [19.4012, 47.5841],
    [19.5604, 47.6213],
    [19.6703, 47.6652],
];

describe("route geometry", () => {
    const route = routeGeometry(COORDS);
    const line = lineString(COORDS);

    it("measures like turf", () => {
        expect(route.cumKm[COORDS.length - 1]).toBeCloseTo(length(line), 3);
        expect(distanceKm(COORDS[0], COORDS[3])).toBeCloseTo(
            distance(COORDS[0], COORDS[3]),
            9,
        );
        expect(bearingDeg(COORDS[2], COORDS[5])).toBeCloseTo(
            bearing(COORDS[2], COORDS[5]),
            9,
        );
    });

    it("decodes a polyline into the same route", () => {
        // [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]] as lat, lng
        const decoded = routeFromPolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
        expect(decoded.coords).toEqual([
            [-120.2, 38.5],
            [-120.95, 40.7],
            [-126.453, 43.252],
        ]);
        expect(decoded.cumKm[0]).toBe(0);
        expect(decoded.cumKm[2]).toBeCloseTo(
            length(lineString(decoded.coords)),
            0,
        );
    });

    it("finds points along the line within metres of turf", () => {
        for (const km of [0, 0.5, 3.2, 17, 31.4, 45]) {
            const ours = pointAlong(route, km);
            const theirs = along(line, km).geometry.coordinates;
            expect(distanceKm(ours, theirs)).toBeLessThan(0.005);
        }
        expect(pointAlong(route, -1)).toEqual(COORDS[0]);
        expect(pointAlong(route, 1e6)).toEqual(COORDS[COORDS.length - 1]);
    });

    it("snaps a position like turf", () => {
        for (const p of [
            [19.12, 47.51],
            [19.25, 47.545],
            [19.6, 47.63],
            [19.0, 47.49],
            [19.8, 47.7],
        ] as [number, number][]) {
            const ours = locateOnRoute(route, p);
            const theirs =
                nearestPointOnLine(line, point(p)).properties.location ?? 0;
            expect(Math.abs(ours - theirs)).toBeLessThan(0.05);
        }
    });
});

describe("tracker", () => {
    it("moves a train along its route at its speed", () => {
        const state = createVehicleState();
        setRoute(state, routeGeometry(COORDS));
        onPositionUpdate(state, [19.1102, 47.5068], 120, 0, null);
        const start = state.distanceAlongRoute;
        tick(state, 0);
        // 500 ms at 120 km/h is 1/60 km
        const { bearing: heading } = tick(state, 500);
        expect(state.distanceAlongRoute - start).toBeCloseTo(1 / 60, 6);
        expect(heading).toBeGreaterThan(45);
        expect(heading).toBeLessThan(90);
    });

    it("brakes before the next stop", () => {
        const state = createVehicleState();
        setRoute(state, {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: COORDS },
        });
        onPositionUpdate(state, COORDS[0], 100, 0, 0.1);
        tick(state, 0);
        for (let t = 1000; t < 60_000; t += 1000) tick(state, t);
        expect(state.distanceAlongRoute).toBeLessThanOrEqual(0.1);
        expect(state.distanceAlongRoute).toBeGreaterThan(0.09);
    });
});
