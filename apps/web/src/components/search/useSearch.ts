import type {
    Station,
    TrainFeatureCollection,
    TrainFeatureProperties,
} from "@megisholavonat/api-client";
import { searchStationsOptions } from "@megisholavonat/api-client/react-query";
import { normalizeSearchText } from "@megisholavonat/core/search";
import {
    compareTrains,
    matchesTrainQuery,
} from "@megisholavonat/core/trainSearch";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

const RECENT_KEY = "mhav.recentStations";
const RECENT_MAX = 5;
const MAX_TRAINS = 6;
const MAX_STATIONS = 6;
/** UIC country code of Hungary: domestic stations come first */
const HUNGARY_PREFIX = "0055";

/** Major stations offered before the user has searched for any. */
export const DEFAULT_STATIONS: Station[] = [
    {
        id: "005510017",
        name: "Budapest-Keleti",
        lat: 47.500278,
        lon: 19.084167,
    },
    { id: "005501024", name: "Budapest-Kelenföld", lat: 47.464444, lon: 19.02 },
    { id: "005510033", name: "Budapest-Nyugati", lat: 47.510833, lon: 19.0575 },
];

let recentCache: Station[] | null = null;
const recentListeners = new Set<() => void>();

function readRecent(): Station[] {
    try {
        const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
        return Array.isArray(parsed) ? (parsed as Station[]) : [];
    } catch {
        return [];
    }
}

export function rememberStation(station: Station) {
    const next = [
        station,
        ...(recentCache ?? readRecent()).filter((s) => s.id !== station.id),
    ].slice(0, RECENT_MAX);
    recentCache = next;
    try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
        // Not remembered across reloads
    }
    for (const listener of recentListeners) listener();
}

const EMPTY: Station[] = [];

/** Recently opened stations, newest first. */
export function useRecentStations(): Station[] {
    return useSyncExternalStore(
        (listener) => {
            recentListeners.add(listener);
            return () => recentListeners.delete(listener);
        },
        () => {
            recentCache ??= readRecent();
            return recentCache;
        },
        () => EMPTY,
    );
}

function useDebounced<T>(value: T, ms: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const id = setTimeout(() => setDebounced(value), ms);
        return () => clearTimeout(id);
    }, [value, ms]);
    return debounced;
}

export interface SearchResults {
    stations: Station[];
    trains: TrainFeatureProperties[];
    loading: boolean;
}

/** Stations from the API and live trains from the map feed. */
export function useSearch(
    query: string,
    trains: TrainFeatureCollection | undefined,
): SearchResults {
    const q = query.trim();
    const debounced = useDebounced(q, 180);
    const stations = useQuery({
        ...searchStationsOptions({
            query: { q: debounced, limit: 12 },
        }),
        enabled: debounced.length >= 2,
        placeholderData: keepPreviousData,
        staleTime: 5 * 60 * 1000,
    });

    const trainResults = useMemo(() => {
        if (!q) return [];
        return (trains?.features ?? [])
            .map((f) => f.properties)
            .filter((p) => matchesTrainQuery(p, q))
            .sort(compareTrains("number", "asc"))
            .slice(0, MAX_TRAINS);
    }, [trains, q]);

    const stationResults = useMemo(() => {
        if (debounced.length < 2 || !stations.data) return [];
        return [...stations.data]
            .sort(
                (a, b) =>
                    Number(b.id.startsWith(HUNGARY_PREFIX)) -
                    Number(a.id.startsWith(HUNGARY_PREFIX)),
            )
            .slice(0, MAX_STATIONS);
    }, [stations.data, debounced]);

    return {
        stations: q.length >= 2 ? stationResults : [],
        trains: trainResults,
        loading: stations.isFetching,
    };
}

/** Splits `text` around the first accent-insensitive match of `query`. */
export function splitMatch(
    text: string,
    query: string,
): [string, string, string] | null {
    const q = normalizeSearchText(query.trim());
    if (!q) return null;
    const chars = Array.from(text);
    const normalized = chars.map((c) => normalizeSearchText(c));
    if (normalized.some((n) => n.length !== 1)) return null;
    const start = normalized.join("").indexOf(q);
    if (start === -1) return null;
    return [
        chars.slice(0, start).join(""),
        chars.slice(start, start + q.length).join(""),
        chars.slice(start + q.length).join(""),
    ];
}
