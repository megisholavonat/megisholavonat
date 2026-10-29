import { FRAME_INTERVAL_MS } from "@megisholavonat/core/vehicleMotion";

// Camera and screen math for the map: pure, unit tested.

/** MapLibre's world is this many px wide at zoom 0 */
const WORLD_PX = 512;
const RAD = Math.PI / 180;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

/** Web Mercator pixel position of [lon, lat] at `zoom` */
export function projectPx(
    [lon, lat]: readonly [number, number],
    zoom: number,
): [number, number] {
    const scale = WORLD_PX * 2 ** zoom;
    const sin = Math.sin(lat * RAD);
    return [
        ((lon + 180) / 360) * scale,
        (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
    ];
}

/**
 * How far apart (px) points are at `zoom`: the larger side of their box.
 * For a bubble's trains at the zoom it would expand to.
 */
export function spreadPx(
    points: readonly (readonly [number, number])[],
    zoom: number,
): number {
    if (points.length < 2) return 0;
    const px = points.map((p) => projectPx(p, zoom));
    const xs = px.map((p) => p[0]);
    const ys = px.map((p) => p[1]);
    return Math.max(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
    );
}

/**
 * Trains of a bubble that still sit this close (px) when it expands are
 * listed to pick from instead (as on the web).
 */
export const STACK_SPREAD_PX = 36;
/** At most this many of them are listed */
export const STACK_MAX = 30;

/** List a bubble's trains rather than zoom: they would still overlap. */
export function shouldListStack(
    points: readonly (readonly [number, number])[],
    expansionZoom: number,
    maxZoom: number,
): boolean {
    return (
        expansionZoom > maxZoom ||
        spreadPx(points, expansionZoom) < STACK_SPREAD_PX
    );
}

/** A sheet covers at most this share of the screen for the camera's sake */
const MAX_SHEET_SHARE = 0.6;

/**
 * Bottom padding (px) that keeps a flown-to place clear of a sheet at
 * `share` of the screen height. A full-height sheet hides the map anyway:
 * the place goes to the top part.
 */
export function sheetPadding(share: number | null, screenHeight: number) {
    if (!share || share <= 0) return 0;
    return Math.round(Math.min(share, MAX_SHEET_SHARE) * screenHeight);
}

/** Metres per px at `zoom` and `lat` */
export function metresPerPx(zoom: number, lat: number): number {
    return (
        (EARTH_CIRCUMFERENCE_M * Math.cos(lat * RAD)) / (WORLD_PX * 2 ** zoom)
    );
}

/** The fastest train on the network, m/s (160 km/h) */
const FASTEST_MPS = 160 / 3.6;
/** A frame is worth drawing once the fastest train moved this far (px) */
const FRAME_STEP_PX = 0.5;
/** At country zoom trains are redrawn at least this often */
export const MAX_FRAME_INTERVAL_MS = 2000;

/**
 * How often to redraw moving trains at `zoom`: as often as the web (12 fps)
 * close in, where a train crosses pixels quickly, and rarely out at country
 * zoom, where it takes seconds to move one. Saves low-end phones most of
 * the work.
 */
export function frameIntervalMs(zoom: number, lat = 47.2): number {
    const ms = ((FRAME_STEP_PX * metresPerPx(zoom, lat)) / FASTEST_MPS) * 1000;
    return Math.min(MAX_FRAME_INTERVAL_MS, Math.max(FRAME_INTERVAL_MS, ms));
}

/** Degrees of longitude one px spans at `zoom`: shorter jumps don't glide */
export function degreesPerPx(zoom: number): number {
    return 360 / (WORLD_PX * 2 ** zoom);
}

/** [west, south, east, north] */
export type Bounds = readonly [number, number, number, number];

/** The bounds grown by `share` of their size on every side */
export function grow(bounds: Bounds, share: number): Bounds {
    const [w, s, e, n] = bounds;
    const dx = (e - w) * share;
    const dy = (n - s) * share;
    return [w - dx, s - dy, e + dx, n + dy];
}

export function contains(
    bounds: Bounds,
    [lon, lat]: readonly [number, number],
): boolean {
    const [w, s, e, n] = bounds;
    return lon >= w && lon <= e && lat >= s && lat <= n;
}
