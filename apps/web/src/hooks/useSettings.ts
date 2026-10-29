import { useSyncExternalStore } from "react";
import { track } from "@/lib/analytics";

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
    showRailwayOverlay: false,
    animateVehicles: true,
};

/** Each setting's name in the `settings_changed` event */
const EVENT_KEYS = {
    showTooltip: "tooltip",
    showStationNames: "station_names",
    stationNamesOpacity: "station_names_opacity",
    showTrains: "trains",
    showTramTrains: "tram_trains",
    showHev: "hev",
    showRailwayOverlay: "railway_layer",
    animateVehicles: "animate_vehicles",
} as const satisfies Record<keyof Settings, string>;

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
    track("settings_changed", {
        key: EVENT_KEYS[key],
        value: typeof value === "boolean" ? (value ? "on" : "off") : undefined,
    });
}

export function useSettings(): Settings {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
