import type { VehiclePositionWithDelay } from "@megisholavonat/api-client";

// Where the train is on the stop list's rail (Google Maps transit style).
// Pure, unit tested.

export interface RailPosition {
    /** Stop index the train last passed (or stands at) */
    from: number;
    /** Stop index it heads to; equal to `from` when standing at a stop */
    to: number;
    /** 0 at `from`, 1 at `to` */
    fraction: number;
}

/** Straight lines between stations are shorter than the track. */
const TRACK_DETOUR = 1.2;
/** Never glide further than this past the last position update. */
const MAX_EXTRAPOLATE_S = 90;
/** Stop short of the next station until the data says it got there. */
const MAX_EXTRAPOLATED_FRACTION = 0.95;

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(
    a: { lat: number; lon: number },
    b: { lat: number; lon: number },
): number {
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad;
    const dLon = (b.lon - a.lon) * rad;
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

/**
 * The train between its last and next stop, from the API's progress along
 * the route. With `extrapolate`, it glides on at its last speed since the
 * position update, so the marker moves between refreshes; it never reaches
 * the next stop on its own.
 */
export function railPosition(
    details: Pick<
        VehiclePositionWithDelay,
        "vehicleProgress" | "speed" | "lastUpdated" | "trip"
    >,
    now: Date = new Date(),
    extrapolate = false,
): RailPosition | null {
    const { lastStopIndex, nextStopIndex, progress } = details.vehicleProgress;
    const stops = details.trip.stoptimes;
    if (lastStopIndex == null || nextStopIndex == null) return null;
    if (
        lastStopIndex < 0 ||
        nextStopIndex >= stops.length ||
        nextStopIndex < lastStopIndex
    ) {
        return null;
    }
    if (lastStopIndex === nextStopIndex) {
        return { from: lastStopIndex, to: nextStopIndex, fraction: 0 };
    }
    let fraction = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);

    const speed = details.speed ?? 0;
    const a = stops[lastStopIndex]?.stop;
    const b = stops[nextStopIndex]?.stop;
    if (extrapolate && speed > 0 && a && b && fraction < 1) {
        const segment = haversineMeters(a, b) * TRACK_DETOUR;
        const elapsed = clamp(
            now.getTime() / 1000 - details.lastUpdated,
            0,
            MAX_EXTRAPOLATE_S,
        );
        if (segment > 0) {
            const ahead = fraction + ((speed / 3.6) * elapsed) / segment;
            fraction = Math.min(
                ahead,
                Math.max(fraction, MAX_EXTRAPOLATED_FRACTION),
            );
        }
    }
    return { from: lastStopIndex, to: nextStopIndex, fraction };
}

/**
 * Where to say the train is: standing at a stop, just past one, or nearing
 * the next ("Abony után", "Szolnok előtt").
 */
export type PlaceLabel =
    | { kind: "at"; stop: number }
    | { kind: "after"; stop: number }
    | { kind: "before"; stop: number };

const AT_STOP_FRACTION = 0.05;

export function placeLabel(
    position: RailPosition,
    speed: number | null | undefined,
): PlaceLabel {
    const moving = (speed ?? 0) > 0;
    if (position.from === position.to) {
        return { kind: "at", stop: position.from };
    }
    if (!moving && position.fraction <= AT_STOP_FRACTION) {
        return { kind: "at", stop: position.from };
    }
    if (!moving && position.fraction >= 1 - AT_STOP_FRACTION) {
        return { kind: "at", stop: position.to };
    }
    return position.fraction < 0.5
        ? { kind: "after", stop: position.from }
        : { kind: "before", stop: position.to };
}
