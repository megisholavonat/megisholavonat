import { isExpired } from "@megisholavonat/core/commute";
import { useSyncExternalStore } from "react";

/**
 * A followed train, kept in this browser only. The shape follows the API's
 * commute follows (train number + weekdays + boarding station), plus what the
 * home rows need to render before any request.
 */
export interface Follow {
    id: string;
    /** Train number, "10" */
    trainNumber: string;
    routeShortName: string;
    destination: string;
    fromStationId: string;
    fromName: string;
    fromLat: number;
    fromLon: number;
    /** Scheduled local departure from the boarding station, s after midnight */
    departureS: number;
    /** Scheduled time from boarding to the end of the trip, s */
    runS?: number | null;
    /** ISO weekdays (1 = Monday); empty for this run only */
    weekdays: number[];
    /** This run only: its local date of departure */
    date: string | null;
    createdAt: number;
}

const KEY = "mhav.follows";
const EMPTY: Follow[] = [];
const listeners = new Set<() => void>();
let cache: Follow[] | null = null;

function isFollow(value: unknown): value is Follow {
    const f = value as Follow;
    return (
        typeof f === "object" &&
        f !== null &&
        typeof f.id === "string" &&
        typeof f.trainNumber === "string" &&
        typeof f.fromStationId === "string" &&
        typeof f.departureS === "number" &&
        Array.isArray(f.weekdays)
    );
}

function read(): Follow[] {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return EMPTY;
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return EMPTY;
        // Single runs that are over are dropped on load
        return parsed.filter(isFollow).filter((f) => !isExpired(f));
    } catch {
        return EMPTY;
    }
}

function write(follows: Follow[]) {
    cache = follows;
    try {
        localStorage.setItem(KEY, JSON.stringify(follows));
    } catch {
        // Storage unavailable: keep the follows for this session only
    }
    for (const listener of listeners) listener();
}

function getSnapshot(): Follow[] {
    cache ??= read();
    return cache;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => {
        if (e.key === null || e.key === KEY) {
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

export function useFollows(): Follow[] {
    return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

function newId(): string {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Adds a follow, or replaces the one with the same id. */
export function saveFollow(
    follow: Omit<Follow, "id" | "createdAt"> & { id?: string },
): Follow {
    const current = getSnapshot();
    const existing = follow.id
        ? current.find((f) => f.id === follow.id)
        : undefined;
    const saved: Follow = {
        ...follow,
        id: existing?.id ?? newId(),
        createdAt: existing?.createdAt ?? Date.now(),
    };
    write(
        existing
            ? current.map((f) => (f.id === saved.id ? saved : f))
            : [...current, saved],
    );
    return saved;
}

export function removeFollow(id: string) {
    write(getSnapshot().filter((f) => f.id !== id));
}

/** The follow of a train number, preferring one boarding at `stationIds`. */
export function findFollow(
    follows: Follow[],
    trainNumber: string,
    stationIds?: readonly (string | null)[],
): Follow | null {
    const same = follows.filter((f) => f.trainNumber === trainNumber);
    if (stationIds) {
        const onRoute = same.find((f) => stationIds.includes(f.fromStationId));
        if (onRoute) return onRoute;
    }
    return same[0] ?? null;
}
