import type {
    TrainFeatureCollection,
    TrainFeatureProperties,
} from "@megisholavonat/api-client";
import { normalizeSearchText } from "@megisholavonat/core/search";
import { staleness } from "@megisholavonat/core/stale";
import {
    compareTrains,
    matchesTrainQuery,
} from "@megisholavonat/core/trainSearch";

// Pure search helpers (screen 3). Unit tested.

export const MAX_TRAINS = 8;

/** Live trains matching the query, by train number. */
export function searchTrains(
    trains: TrainFeatureCollection | undefined,
    query: string,
    now: Date = new Date(),
): TrainFeatureProperties[] {
    if (!query.trim() || !trains) return [];
    return trains.features
        .map((f) => f.properties)
        .filter(
            (p) =>
                staleness(p.lastUpdated, now) !== "hidden" &&
                matchesTrainQuery(p, query),
        )
        .sort(compareTrains("number", "asc"))
        .slice(0, MAX_TRAINS);
}

/**
 * Splits `text` around the first accent-insensitive match of `query`, for
 * bold highlighting ("Budapest-<b>Kel</b>eti").
 */
export function highlight(
    text: string,
    query: string,
): { text: string; match: boolean }[] {
    const q = normalizeSearchText(query.trim());
    if (!q) return [{ text, match: false }];
    // Hungarian letters are precomposed, so indices line up after normalising
    const index = normalizeSearchText(text).indexOf(q);
    if (index < 0) return [{ text, match: false }];
    return [
        { text: text.slice(0, index), match: false },
        { text: text.slice(index, index + q.length), match: true },
        { text: text.slice(index + q.length), match: false },
    ].filter((part) => part.text.length > 0);
}
