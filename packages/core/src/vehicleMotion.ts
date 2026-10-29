import {
    createVehicleState,
    onPositionUpdate,
    routeFromPolyline,
    setRoute,
    tick,
    type VehicleState,
} from "./VehicleTracker";

// Smooth train movement between feed updates, shared by the web map and the
// app: trains are dead-reckoned along their route (VehicleTracker) and a
// fresh position glides in instead of jumping. The render loop around it
// (requestAnimationFrame, the map source) stays with each platform.

/** Interpolated positions are pushed to the map at most this often */
export const FRAME_INTERVAL_MS = 1000 / 12;
/** A fresh position glides in over this long instead of jumping */
export const GLIDE_MS = 1000;
/** Jumps longer than this (degrees, ~5 km) are not glided: they teleport */
export const GLIDE_MAX_DEG = 0.05;
/** A train counts as moved past this (degrees, ~0.1 m)… */
export const COORD_EPSILON = 1e-6;
/** …or turned past this many degrees */
export const BEARING_EPSILON = 0.5;

/** Where a train is drawn: [lon, lat, bearing] */
export type Shown = [number, number, number];
/** A glide in progress: where it started, and when */
export type Glide = { from: Shown; start: number };

/** Absolute difference of two bearings, 0..180 */
export function bearingDelta(a: number, b: number): number {
    return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

/** From bearing a towards b by k (0..1), the short way round */
export function lerpBearing(a: number, b: number, k: number): number {
    const d = ((((b - a) % 360) + 540) % 360) - 180;
    return a + d * k;
}

export function easeInOut(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export function easeOut(t: number): number {
    return 1 - (1 - t) ** 3;
}

/** Moved or turned enough to be drawn again */
export function hasMoved(prev: Shown | undefined, pos: Shown): boolean {
    return (
        !prev ||
        Math.abs(prev[0] - pos[0]) > COORD_EPSILON ||
        Math.abs(prev[1] - pos[1]) > COORD_EPSILON ||
        bearingDelta(prev[2], pos[2]) > BEARING_EPSILON
    );
}

/** What the feed says about one train, as the trackers need it */
export interface FeedVehicle {
    vehicleId: string;
    lon: number;
    lat: number;
    /** Degrees */
    heading?: number | null;
    /** m/s (GTFS-RT) */
    speed?: number | null;
    routePolyline?: string | null;
    /** km, from the API */
    distanceToNextStop?: number | null;
}

/**
 * Brings the trackers in step with a feed: each train's new position and
 * speed, and trackers of trains gone from the feed dropped. Routes that
 * changed are decoded later: the returned jobs each decode one, so a caller
 * can spread them over several frames (a feed holds hundreds of long
 * routes). Until its route is in, a train stays where the feed puts it.
 */
export function syncTrackers(
    trackers: Map<string, VehicleState>,
    routes: Map<string, string>,
    vehicles: Iterable<FeedVehicle>,
): (() => void)[] {
    const active = new Set<string>();
    const pending: (() => void)[] = [];
    for (const v of vehicles) {
        active.add(v.vehicleId);
        let state = trackers.get(v.vehicleId);
        if (!state) {
            state = createVehicleState();
            trackers.set(v.vehicleId, state);
        }
        // Speed in km/h for dead reckoning; the next stop is already in km
        const update = (s: VehicleState) =>
            onPositionUpdate(
                s,
                [v.lon, v.lat],
                (v.speed ?? 0) * 3.6,
                v.heading ?? 0,
                v.distanceToNextStop ?? null,
            );
        update(state);
        const polyline = v.routePolyline;
        if (polyline && routes.get(v.vehicleId) !== polyline) {
            const target = state;
            pending.push(() => {
                routes.set(v.vehicleId, polyline);
                setRoute(target, routeFromPolyline(polyline));
                // Snaps to the route and places the next stop on it
                update(target);
            });
        }
    }
    for (const id of trackers.keys()) {
        if (!active.has(id)) {
            trackers.delete(id);
            routes.delete(id);
        }
    }
    return pending;
}

/**
 * One train's position for a frame: moved along its route (`advance`), and
 * when the feed just moved it (`fresh`), gliding from where it was drawn
 * (`prev`) over GLIDE_MS. `minGlideDeg`: shorter jumps than this snap (a
 * glide nobody could see is not worth the frames).
 */
export function vehicleFrame(
    state: VehicleState,
    timestamp: number,
    {
        advance,
        fresh,
        prev,
        glides,
        id,
        minGlideDeg = COORD_EPSILON,
        maxDeltaMs,
    }: {
        advance: boolean;
        fresh: boolean;
        prev: Shown | undefined;
        glides: Map<string, Glide>;
        id: string;
        minGlideDeg?: number;
        /** See tick: raised by callers that draw less often than 1 fps */
        maxDeltaMs?: number;
    },
): Shown {
    const target = advance
        ? tick(state, timestamp, maxDeltaMs)
        : { coords: state.coords, bearing: state.bearing };
    let pos: Shown = [target.coords[0], target.coords[1], target.bearing];
    if (fresh && prev) {
        const dx = Math.abs(prev[0] - pos[0]);
        const dy = Math.abs(prev[1] - pos[1]);
        const far = dx > GLIDE_MAX_DEG || dy > GLIDE_MAX_DEG;
        const moved = dx > minGlideDeg || dy > minGlideDeg;
        if (!far && moved) glides.set(id, { from: prev, start: timestamp });
        else if (far) glides.delete(id);
    }
    const glide = glides.get(id);
    if (glide) {
        const t = (timestamp - glide.start) / GLIDE_MS;
        if (t >= 1) {
            glides.delete(id);
        } else {
            const k = easeInOut(Math.max(0, t));
            pos = [
                glide.from[0] + (pos[0] - glide.from[0]) * k,
                glide.from[1] + (pos[1] - glide.from[1]) * k,
                lerpBearing(glide.from[2], pos[2], k),
            ];
        }
    }
    return pos;
}
