import { useSyncExternalStore } from "react";

// What the sheets ask of the map, which sits under them in another route:
// the station to mark, where to fly, and how much of the screen the open
// sheet covers. Lives outside React state, like selection.ts.

export interface FocusStation {
    id: string;
    name: string;
    lat: number;
    lon: number;
}

/** A place, or a train found in the feed when the map flies */
export type FlyTarget =
    | { kind: "place"; lon: number; lat: number; zoom: number; key: number }
    | { kind: "train"; vehicleId: string; zoom: number; key: number };

export interface MapFocus {
    station: FocusStation | null;
    fly: FlyTarget | null;
    /** Share of the screen the topmost open sheet covers */
    sheet: number | null;
}

/** Opening a train flies at least this close (as on the web) */
export const TRAIN_FLY_ZOOM = 12;

let state: MapFocus = { station: null, fly: null, sheet: null };
/** Open sheets, oldest first: the last one is on top */
const sheets = new Map<string, number>();
let key = 0;
/** The train last tapped on the map: its sheet doesn't fly the map */
let tapped: string | null = null;

const listeners = new Set<() => void>();

function set(patch: Partial<MapFocus>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
}

export function setFocusStation(station: FocusStation | null): void {
    const current = state.station;
    if (
        current === station ||
        (current &&
            station &&
            current.id === station.id &&
            current.lat === station.lat &&
            current.lon === station.lon &&
            current.name === station.name)
    ) {
        return;
    }
    set({ station });
}

export function flyToPlace(lon: number, lat: number, zoom: number): void {
    set({ fly: { kind: "place", lon, lat, zoom, key: ++key } });
}

export function flyToTrain(vehicleId: string): void {
    set({
        fly: { kind: "train", vehicleId, zoom: TRAIN_FLY_ZOOM, key: ++key },
    });
}

/** A train tapped on the map: it is already in view */
export function noteMapTap(vehicleId: string): void {
    tapped = vehicleId;
}

/** Whether the train's sheet was opened by a tap on the map (asks once) */
export function takeMapTap(vehicleId: string): boolean {
    const hit = tapped === vehicleId;
    tapped = null;
    return hit;
}

/** A sheet at `share` of the screen; null when it closes */
export function setSheet(id: string, share: number | null): void {
    // A new sheet goes on top; one that reports again keeps its place
    if (share === null) sheets.delete(id);
    else sheets.set(id, share);
    const top = [...sheets.values()].pop() ?? null;
    if (top !== state.sheet) set({ sheet: top });
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getMapFocus(): MapFocus {
    return state;
}

export function useMapFocus(): MapFocus {
    return useSyncExternalStore(subscribe, getMapFocus);
}
