import type {
    TrainFeatureCollection,
    TrainFeatureProperties,
} from "@megisholavonat/api-client";
import { trainDisplay } from "@megisholavonat/core/display";
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

export type BrowseSort = "delay" | "number";

/**
 * Every train on the map, latest first or by number. Trains not running
 * their trip (waiting, arrived) and old data sort below the live ones when
 * sorting by delay, since their delay isn't shown.
 */
export function browseTrains(
    trains: TrainFeatureCollection | undefined,
    sort: BrowseSort,
    now: Date = new Date(),
): TrainFeatureProperties[] {
    const list = (trains?.features ?? [])
        .map((f) => f.properties)
        .filter((p) => staleness(p.lastUpdated, now) !== "hidden");
    if (sort === "number") return list.sort(compareTrains("number", "asc"));
    const shownDelay = (p: TrainFeatureProperties) => {
        const display = trainDisplay(p, now);
        return display.state === "running" && display.delay !== null
            ? display.delay
            : Number.NEGATIVE_INFINITY;
    };
    return list
        .map((p) => ({ p, delay: shownDelay(p) }))
        .sort(
            (a, b) =>
                b.delay - a.delay || compareTrains("number", "asc")(a.p, b.p),
        )
        .map(({ p }) => p);
}

/** Live trains at least 5 minutes late, latest first. */
export function lateTrains(
    trains: TrainFeatureCollection | undefined,
    now: Date = new Date(),
    limit = MAX_TRAINS,
): TrainFeatureProperties[] {
    return browseTrains(trains, "delay", now)
        .filter((p) => {
            const display = trainDisplay(p, now);
            return (
                display.state === "running" &&
                display.level !== "onTime" &&
                display.level !== "stale"
            );
        })
        .slice(0, limit);
}
