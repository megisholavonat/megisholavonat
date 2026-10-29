import type {
    Station,
    TrainFeatureCollection,
    TrainFeatureProperties,
} from "@megisholavonat/api-client";
import { searchStationsOptions } from "@megisholavonat/api-client/react-query";
import { normalizeSearchText } from "@megisholavonat/core/search";
import { staleness } from "@megisholavonat/core/stale";
import {
    browseTrains,
    compareTrains,
    isNumericQuery,
    lateTrains,
    matchesTrainQuery,
    type SortDirection,
    type TrainSortOption,
} from "@megisholavonat/core/trainSearch";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

const RECENT_KEY = "mhav.recentStations";
const RECENT_MAX = 5;
const MAX_TRAINS = 6;
const MAX_STATIONS = 6;
/** Fetched before ranking, so the main stations are never cut off */
const STATION_FETCH = 30;
/** Late trains under an empty search field, as in the app */
export const LATE_PREVIEW = 5;
/** UIC country code of Hungary: domestic stations come first */
const HUNGARY_PREFIX = "0055";

/**
 * The busiest stations, most used first. A query that starts their name or
 * a word of it ("Bud", "keleti", "Misk") ranks them above the small stops
 * that share the prefix (Budafa, Budafok, Kelebia, Miskolc-Gömöri).
 */
const MAIN_STATIONS = [
    "005510017", // Budapest-Keleti
    "005510033", // Budapest-Nyugati
    "005501024", // Budapest-Kelenföld
    "005501016", // Budapest-Déli
    "005510173", // Kőbánya-Kispest
    "005513748", // Szolnok
    "005513912", // Debrecen
    "005511387", // Miskolc-Tiszai
    "005517228", // Szeged
    "005501289", // Győr
    "005503269", // Székesfehérvár
    "005507294", // Pécs
    "005517111", // Kecskemét
    "005514019", // Nyíregyháza
    "004302246", // Szombathely
    "005513722", // Cegléd
    "005511205", // Hatvan
    "005510090", // Zugló
];

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
    /** A number was typed: trains are what it most likely means */
    trainsFirst: boolean;
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
            query: { q: debounced, limit: STATION_FETCH },
        }),
        enabled: debounced.length >= 2,
        placeholderData: keepPreviousData,
        staleTime: 5 * 60 * 1000,
    });

    const trainResults = useMemo(() => {
        if (!q) return [];
        return (trains?.features ?? [])
            .map((f) => f.properties)
            .filter(
                (p) =>
                    staleness(p.lastUpdated) !== "hidden" &&
                    matchesTrainQuery(p, q),
            )
            .sort(compareTrains("number", "asc"))
            .slice(0, MAX_TRAINS);
    }, [trains, q]);

    const stationResults = useMemo(() => {
        if (debounced.length < 2 || !stations.data) return [];
        return rankStations(stations.data, debounced).slice(0, MAX_STATIONS);
    }, [stations.data, debounced]);

    return {
        stations: q.length >= 2 ? stationResults : [],
        trains: trainResults,
        trainsFirst: isNumericQuery(q),
        loading: stations.isFetching,
    };
}

/**
 * Stops nobody searches by number: kilometre-post halts ("Km. 107+000 H.")
 * and platforms of foreign stations ("München Hbf Gl.5-10").
 */
const NUMBERED_STOP = /^km\.?\s*\d|\bgl\.\s*\d/i;

/**
 * Re-ranks the API's matches: an exact name first, then the main stations
 * the query starts a word of, then the rest in the API's order (prefix
 * matches first), domestic before foreign. A number drops the stops that
 * only match through the digits in their names.
 */
export function rankStations(stations: Station[], query: string): Station[] {
    const q = normalizeSearchText(query.trim());
    if (isNumericQuery(q)) {
        stations = stations.filter((s) => !NUMBERED_STOP.test(s.name));
    }
    const tier = (station: Station) => {
        const name = normalizeSearchText(station.name);
        if (name === q) return -1;
        const main = MAIN_STATIONS.indexOf(station.id);
        const wordStart =
            name.startsWith(q) ||
            name.split(/[\s\-,.()]+/).some((word) => word.startsWith(q));
        if (main !== -1 && wordStart) return main;
        return (
            MAIN_STATIONS.length +
            (station.id.startsWith(HUNGARY_PREFIX) ? 0 : 1)
        );
    };
    return stations
        .map((station, index) => ({ station, index, tier: tier(station) }))
        .sort((a, b) => a.tier - b.tier || a.index - b.index)
        .map(({ station }) => station);
}

/** The late trains and the sortable list of every train, from the feed. */
export function useTrainLists(
    trains: TrainFeatureCollection | undefined,
    sort: TrainSortOption,
    direction: SortDirection,
) {
    // Re-sorted with the feed and the sort, not on clock ticks, so rows
    // don't jump between polls
    return useMemo(() => {
        const list = (trains?.features ?? []).map((f) => f.properties);
        const now = new Date();
        return {
            late: lateTrains(list, LATE_PREVIEW, now),
            all: browseTrains(list, sort, direction, now),
        };
    }, [trains, sort, direction]);
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
