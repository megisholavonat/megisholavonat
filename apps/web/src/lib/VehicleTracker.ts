import { along, bearing, length, nearestPointOnLine } from "@turf/turf";
import type { Feature, LineString, Point } from "geojson";

const LOOKAHEAD_KM = 0.01;
const MAX_DELTA_MS = 1_000;

const BRAKING_WINDOW_KM = 0.25;

export type VehicleState = {
    route: Feature<LineString> | null;
    routeLengthKm: number;
    distanceAlongRoute: number;
    speedKmh: number;
    nextStopKm: number | null;
    lastTimestamp: DOMHighResTimeStamp | null;
    coords: [number, number];
    bearing: number;
    initialized: boolean;
};

export function createVehicleState(): VehicleState {
    return {
        route: null,
        routeLengthKm: 0,
        distanceAlongRoute: 0,
        speedKmh: 0,
        nextStopKm: null,
        lastTimestamp: null,
        coords: [0, 0],
        bearing: 0,
        initialized: false,
    };
}

export function setRoute(
    state: VehicleState,
    route: Feature<LineString>,
): void {
    state.route = route;
    state.routeLengthKm = length(route, { units: "kilometers" });
    if (state.initialized) {
        snapToRoute(state, state.coords);
    }
}

export function onPositionUpdate(
    state: VehicleState,
    lngLat: [number, number],
    speedKmh: number,
    headingFallback = 0,
    distanceToNextStopKm: number | null = null,
): void {
    state.speedKmh = speedKmh;
    state.coords = lngLat;
    if (!state.initialized) {
        state.bearing = headingFallback;
        state.initialized = true;
    }
    if (state.route) {
        snapToRoute(state, lngLat);
        // Resolve next-stop km from the snapped position + server-reported distance
        state.nextStopKm =
            distanceToNextStopKm !== null
                ? state.distanceAlongRoute + distanceToNextStopKm
                : null;
    }
}

export function tick(
    state: VehicleState,
    timestamp: DOMHighResTimeStamp,
): { coords: [number, number]; bearing: number } {
    // Without a route there is nothing to interpolate — return as-is
    if (!state.initialized || !state.route) {
        return { coords: state.coords, bearing: state.bearing };
    }

    if (state.lastTimestamp !== null && state.speedKmh > 0) {
        const deltaMs = Math.min(timestamp - state.lastTimestamp, MAX_DELTA_MS);
        const fullDeltaKm = state.speedKmh * (deltaMs / 3_600_000);

        state.distanceAlongRoute = advanceWithBraking(
            state.distanceAlongRoute,
            fullDeltaKm,
            state.nextStopKm,
            state.routeLengthKm,
        );
    }

    state.lastTimestamp = timestamp;

    const currentPoint = along(state.route, state.distanceAlongRoute, {
        units: "kilometers",
    });
    state.coords = currentPoint.geometry.coordinates as [number, number];

    const lookAheadDist = state.distanceAlongRoute + LOOKAHEAD_KM;
    if (lookAheadDist < state.routeLengthKm) {
        const lookAheadPoint = along(state.route, lookAheadDist, {
            units: "kilometers",
        });
        state.bearing = bearing(currentPoint, lookAheadPoint);
    }

    return { coords: state.coords, bearing: state.bearing };
}

function advanceWithBraking(
    current: number,
    fullDeltaKm: number,
    nextStopKm: number | null,
    routeLengthKm: number,
): number {
    if (nextStopKm === null) {
        return Math.min(current + fullDeltaKm, routeLengthKm);
    }

    const remaining = nextStopKm - current;

    if (remaining <= 0) {
        return current;
    }

    if (remaining > BRAKING_WINDOW_KM) {
        return Math.min(current + fullDeltaKm, nextStopKm);
    }

    const speedFactor = remaining / BRAKING_WINDOW_KM;
    const scaledDelta = fullDeltaKm * speedFactor;

    return Math.min(current + scaledDelta, nextStopKm);
}

function snapToRoute(state: VehicleState, lngLat: [number, number]): void {
    if (!state.route) return;
    const point: Feature<Point> = {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: lngLat },
    };
    const snapped = nearestPointOnLine(state.route, point);
    state.distanceAlongRoute =
        snapped.properties.location ?? state.distanceAlongRoute;
}
