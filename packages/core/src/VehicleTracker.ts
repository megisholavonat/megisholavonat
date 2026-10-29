import type { Feature, LineString } from "geojson";

const LOOKAHEAD_KM = 0.01;
const MAX_DELTA_MS = 1_000;

const BRAKING_WINDOW_KM = 0.25;

/** Earth radius in km, as turf uses */
const EARTH_KM = 6371.0088;
const RAD = Math.PI / 180;

/**
 * A route with the distance to each vertex worked out once, so a frame's
 * position is a binary search instead of a walk over every segment (turf's
 * `along` measured the whole line again for every train, 12 times a second).
 */
export type RouteGeometry = {
    coords: [number, number][];
    /** Km from the start to each vertex */
    cumKm: Float64Array;
};

export type VehicleState = {
    route: RouteGeometry | null;
    routeLengthKm: number;
    distanceAlongRoute: number;
    speedKmh: number;
    nextStopKm: number | null;
    lastTimestamp: number | null;
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

/** Great-circle distance in km (haversine), as turf's `distance` */
export function distanceKm(
    a: readonly [number, number] | number[],
    b: readonly [number, number] | number[],
): number {
    const dLat = (b[1] - a[1]) * RAD;
    const dLon = (b[0] - a[0]) * RAD;
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.sin(dLon / 2) ** 2 * Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD);
    return 2 * EARTH_KM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Initial bearing from a to b in degrees (-180..180), as turf's `bearing` */
export function bearingDeg(
    a: readonly [number, number] | number[],
    b: readonly [number, number] | number[],
): number {
    const lat1 = a[1] * RAD;
    const lat2 = b[1] * RAD;
    const dLon = (b[0] - a[0]) * RAD;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x =
        Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return Math.atan2(y, x) / RAD;
}

/**
 * Segment length in km. Route segments are short, so a flat projection at
 * their mid-latitude matches the haversine to well under a metre at a
 * fraction of the trigonometry, which matters across a whole feed of routes.
 */
function segmentKm(a: readonly number[], b: readonly number[]): number {
    const dx = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * RAD);
    const dy = b[1] - a[1];
    return Math.sqrt(dx * dx + dy * dy) * RAD * EARTH_KM;
}

export function routeGeometry(coords: [number, number][]): RouteGeometry {
    const cumKm = new Float64Array(coords.length);
    for (let i = 1; i < coords.length; i++) {
        cumKm[i] = cumKm[i - 1] + segmentKm(coords[i - 1], coords[i]);
    }
    return { coords, cumKm };
}

/** Decodes an encoded polyline (precision 5) straight into a route */
export function routeFromPolyline(encoded: string): RouteGeometry {
    const coords: [number, number][] = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    while (index < encoded.length) {
        let b: number;
        let shift = 0;
        let result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        lat += result & 1 ? ~(result >> 1) : result >> 1;
        shift = 0;
        result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        lng += result & 1 ? ~(result >> 1) : result >> 1;
        coords.push([lng / 1e5, lat / 1e5]);
    }
    return routeGeometry(coords);
}

/** The point `km` along the route, clamped to its ends */
export function pointAlong(route: RouteGeometry, km: number): [number, number] {
    const { coords, cumKm } = route;
    const n = coords.length;
    if (n === 0) return [0, 0];
    if (km <= 0 || n === 1) return [coords[0][0], coords[0][1]];
    if (km >= cumKm[n - 1]) return [coords[n - 1][0], coords[n - 1][1]];
    // Last vertex at or before km
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cumKm[mid] <= km) lo = mid;
        else hi = mid;
    }
    const seg = cumKm[hi] - cumKm[lo];
    const t = seg > 0 ? (km - cumKm[lo]) / seg : 0;
    const a = coords[lo];
    const b = coords[hi];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Km along the route of the route point nearest to `point` */
export function locateOnRoute(
    route: RouteGeometry,
    point: readonly [number, number],
): number {
    const { coords, cumKm } = route;
    if (coords.length < 2) return 0;
    // Segments are short, so a flat projection scaled at the point's
    // latitude finds the nearest one; the distance along is then exact
    const kx = Math.cos(point[1] * RAD);
    let best = Number.POSITIVE_INFINITY;
    let bestKm = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        const a = coords[i];
        const b = coords[i + 1];
        const ax = (a[0] - point[0]) * kx;
        const ay = a[1] - point[1];
        const dx = (b[0] - a[0]) * kx;
        const dy = b[1] - a[1];
        const len2 = dx * dx + dy * dy;
        const t =
            len2 > 0
                ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2))
                : 0;
        const px = ax + dx * t;
        const py = ay + dy * t;
        const d2 = px * px + py * py;
        if (d2 < best) {
            best = d2;
            bestKm = cumKm[i] + (cumKm[i + 1] - cumKm[i]) * t;
        }
    }
    return bestKm;
}

export function setRoute(
    state: VehicleState,
    route: Feature<LineString> | RouteGeometry,
): void {
    const geometry =
        "cumKm" in route
            ? route
            : routeGeometry(route.geometry.coordinates as [number, number][]);
    state.route = geometry;
    state.routeLengthKm = geometry.cumKm[geometry.cumKm.length - 1] ?? 0;
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
    timestamp: number,
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

    const current = pointAlong(state.route, state.distanceAlongRoute);
    state.coords = current;

    const lookAheadDist = state.distanceAlongRoute + LOOKAHEAD_KM;
    if (lookAheadDist < state.routeLengthKm) {
        const ahead = pointAlong(state.route, lookAheadDist);
        state.bearing = bearingDeg(current, ahead);
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
    state.distanceAlongRoute = locateOnRoute(state.route, lngLat);
}
