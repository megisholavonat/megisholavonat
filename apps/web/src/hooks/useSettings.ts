import { useSyncExternalStore } from "react";

/** Per-device preferences, stored as `mhav.settings.<key>` in localStorage. */
export interface Settings {
    showTooltip: boolean;
    showStationNames: boolean;
    stationNamesOpacity: number;
    showTrains: boolean;
    showTramTrains: boolean;
    showHev: boolean;
    showRailwayOverlay: boolean;
    animateVehicles: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
    showTooltip: true,
    showStationNames: true,
    stationNamesOpacity: 1,
    showTrains: true,
    showTramTrains: true,
    showHev: true,
    showRailwayOverlay: true,
    animateVehicles: true,
};

const PREFIX = "mhav.settings.";
const listeners = new Set<() => void>();
let cache: Settings | null = null;

function read(): Settings {
    const settings = { ...DEFAULT_SETTINGS };
    try {
        for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
            const raw = localStorage.getItem(PREFIX + key);
            if (raw === null) continue;
            if (key === "stationNamesOpacity") {
                const value = Number.parseFloat(raw);
                if (Number.isFinite(value)) settings[key] = value;
            } else {
                settings[key] = raw === "true";
            }
        }
    } catch {
        // Storage unavailable: defaults
    }
    return settings;
}

function getSnapshot(): Settings {
    cache ??= read();
    return cache;
}

function getServerSnapshot(): Settings {
    return DEFAULT_SETTINGS;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => {
        if (e.key === null || e.key.startsWith(PREFIX)) {
            cache = read();
            listener();
        }
    };
    window.addEventListener("storage", onStorage);
    return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
    };
}

export function setSetting<K extends keyof Settings>(
    key: K,
    value: Settings[K],
) {
    try {
        localStorage.setItem(PREFIX + key, String(value));
    } catch {
        // Keep the change for this session only
    }
    cache = { ...getSnapshot(), [key]: value };
    for (const listener of listeners) listener();
}

export function useSettings(): Settings {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
