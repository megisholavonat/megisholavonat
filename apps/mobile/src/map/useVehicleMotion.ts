import type { TrainFeatureCollection } from "@megisholavonat/api-client";
import { tick, type VehicleState } from "@megisholavonat/core/VehicleTracker";
import {
    FRAME_INTERVAL_MS,
    type Glide,
    hasMoved,
    type Shown,
    syncTrackers,
    vehicleFrame,
} from "@megisholavonat/core/vehicleMotion";
import { type RefObject, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
    type Bounds,
    contains,
    degreesPerPx,
    frameIntervalMs,
    grow,
} from "./camera";

/** What the map shows, kept up to date by its region events */
export interface MapView {
    zoom: number;
    /** null until the map first reports it */
    bounds: Bounds | null;
    /** The user is panning or zooming */
    moving: boolean;
}

/** Budget of one slice of route decoding, well inside a frame */
const ROUTE_SLICE_MS = 8;
/** Trains this share of the view beyond its edges move too */
const VIEW_MARGIN = 0.15;

const clock = () =>
    typeof performance !== "undefined" ? performance.now() : Date.now();

/**
 * Smooth movement on the app's map, as on the web: trains move along their
 * route between feed updates and a fresh position glides in (shared logic
 * in core/vehicleMotion). Kind to low-end phones: only trains in view (and
 * a margin) are redrawn, as often as they visibly move at the zoom
 * (frameIntervalMs: 12 fps close in, every 2 s at country zoom), nothing
 * while the user pans or the app is in the background, and jumps under a
 * pixel are not glided.
 *
 * Returns where each train is drawn, or null when off (`enabled` false:
 * the setting or reduce motion): the feed's positions then. The caller
 * re-renders on frames that moved a train (`version`).
 */
export function useVehicleMotion(
    trains: TrainFeatureCollection | undefined,
    enabled: boolean,
    view: RefObject<MapView>,
): { shown: ReadonlyMap<string, Shown> | null; version: number } {
    const trackers = useRef(new Map<string, VehicleState>());
    const routes = useRef(new Map<string, string>());
    const shown = useRef(new Map<string, Shown>());
    const feed = useRef(trains);
    /** Draws a frame now (the loop sets it while running) */
    const kick = useRef<(() => void) | null>(null);
    const [version, setVersion] = useState(0);

    // The trackers follow the feed; new routes are decoded in slices
    useEffect(() => {
        feed.current = trains;
        if (!trains) return;
        const pending = syncTrackers(
            trackers.current,
            routes.current,
            trains.features.map((f) => f.properties),
        );
        let timer: ReturnType<typeof setTimeout> | null = null;
        let next = 0;
        const slice = () => {
            timer = null;
            const until = clock() + ROUTE_SLICE_MS;
            while (next < pending.length && clock() < until) pending[next++]();
            if (next < pending.length) timer = setTimeout(slice, 0);
        };
        if (pending.length) timer = setTimeout(slice, 0);
        // New data is drawn right away, not at the next (maybe slow) frame
        kick.current?.();
        return () => {
            if (timer !== null) clearTimeout(timer);
        };
    }, [trains]);

    useEffect(() => {
        if (!enabled) return;
        const drawn = shown.current;
        const glides = new Map<string, Glide>();
        let timer: ReturnType<typeof setTimeout> | null = null;
        let lastFeed: TrainFeatureCollection | undefined;
        let wasMoving = false;
        let active = AppState.currentState !== "background";

        const restartClocks = () => {
            for (const state of trackers.current.values()) {
                state.lastTimestamp = null;
            }
        };

        const update = (now: number, advance: boolean, interval: number) => {
            const data = feed.current;
            if (!data) return false;
            const fresh = data !== lastFeed;
            const { zoom, bounds } = view.current;
            const area = bounds ? grow(bounds, VIEW_MARGIN) : null;
            const minGlideDeg = degreesPerPx(zoom);
            // A step may cover the time since the last frame, not more
            const maxDeltaMs = Math.max(1000, interval * 1.5);
            let changed = fresh;
            for (const feature of data.features) {
                const id = feature.properties.vehicleId;
                const state = trackers.current.get(id);
                if (!state) continue;
                const prev = drawn.get(id);
                const at = prev ?? state.coords;
                if (area && !contains(area, [at[0], at[1]])) {
                    // Out of view: the reckoning goes on, but it is drawn
                    // only when the feed moves it
                    if (advance) tick(state, now, maxDeltaMs);
                    if (fresh || !prev) {
                        glides.delete(id);
                        const pos: Shown = [
                            state.coords[0],
                            state.coords[1],
                            state.bearing,
                        ];
                        if (hasMoved(prev, pos)) {
                            drawn.set(id, pos);
                            changed = true;
                        }
                    }
                    continue;
                }
                const pos = vehicleFrame(state, now, {
                    advance,
                    fresh,
                    prev,
                    glides,
                    id,
                    minGlideDeg,
                    maxDeltaMs,
                });
                if (hasMoved(prev, pos)) {
                    drawn.set(id, pos);
                    changed = true;
                }
            }
            if (fresh) {
                lastFeed = data;
                for (const id of drawn.keys()) {
                    if (!trackers.current.has(id)) drawn.delete(id);
                }
            }
            return changed;
        };

        const schedule = (ms: number) => {
            if (timer === null && active) timer = setTimeout(frame, ms);
        };

        const frame = () => {
            timer = null;
            const now = clock();
            const fresh = feed.current !== lastFeed;
            const current = view.current;
            // Leave the map alone while the user pans or zooms, except to
            // show new data
            if (current.moving) {
                wasMoving = true;
                if (fresh && update(now, false, FRAME_INTERVAL_MS)) {
                    setVersion((v) => v + 1);
                }
                schedule(FRAME_INTERVAL_MS * 2);
                return;
            }
            if (wasMoving) {
                wasMoving = false;
                restartClocks();
            }
            const interval =
                glides.size > 0
                    ? FRAME_INTERVAL_MS
                    : frameIntervalMs(current.zoom);
            if (update(now, true, interval)) setVersion((v) => v + 1);
            // A glide just started: draw it smoothly
            schedule(glides.size > 0 ? FRAME_INTERVAL_MS : interval);
        };

        const subscription = AppState.addEventListener("change", (state) => {
            const next = state === "active";
            if (next === active) return;
            active = next;
            if (active) {
                // Continue from where the trains were frozen
                restartClocks();
                schedule(0);
            } else if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
        });
        kick.current = () => {
            if (timer !== null) clearTimeout(timer);
            timer = null;
            schedule(0);
        };
        restartClocks();
        schedule(0);
        return () => {
            kick.current = null;
            subscription.remove();
            if (timer !== null) clearTimeout(timer);
            drawn.clear();
        };
    }, [enabled, view]);

    return { shown: enabled ? shown.current : null, version };
}
