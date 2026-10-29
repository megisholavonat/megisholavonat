import type { TrainFeatureProperties } from "@megisholavonat/api-client";
import { getDelayLevel } from "./delay";
import { trainDisplay } from "./display";
import { matchesMavRoute } from "./mavRoutes";
import { normalizeSearchText } from "./search";
import { staleness } from "./stale";
import { trainNumber } from "./trainName";

export type TrainSortOption = "number" | "delay" | "speed";
export type SortDirection = "asc" | "desc";

/** A vehicle (UIC) number is matched from this many digits on */
const MIN_VEHICLE_DIGITS = 5;

/** Digits only, ignoring spaces and dashes: "10", "0480 012-3". */
export function isNumericQuery(searchQuery: string): boolean {
    return /^\d+$/.test(searchQuery.replace(/[\s-]/g, ""));
}

/**
 * Whether a train matches the free-text search query (trip/route name, MÁV
 * route icon or UIC number). Digits alone match the start of the train
 * number, or a vehicle number from five digits on: "10" finds 10 and 104,
 * not every train with a 10 somewhere in its route or vehicle id.
 */
export function matchesTrainQuery(
    result: TrainFeatureProperties,
    searchQuery: string,
): boolean {
    if (!searchQuery.trim()) return true;

    if (isNumericQuery(searchQuery)) {
        const digits = searchQuery.replace(/[\s-]/g, "");
        const number = trainNumber(result.tripShortName ?? "");
        return (
            number.startsWith(digits) ||
            (digits.length >= MIN_VEHICLE_DIGITS &&
                !!result.vehicleId &&
                result.vehicleId.slice(2).includes(digits))
        );
    }

    const query = normalizeSearchText(searchQuery.trim());
    const tripName = normalizeSearchText(result.tripShortName ?? "");
    const routeName = normalizeSearchText(result.routeShortName ?? "");
    const routeMatches = matchesMavRoute(result.routeShortName, searchQuery);

    let vehicleIdMatches = false;
    try {
        if (
            result.vehicleId &&
            typeof result.vehicleId === "string" &&
            result.vehicleId.length > 2
        ) {
            const vehicleId = normalizeSearchText(result.vehicleId.slice(2));
            const sanitizedQuery = query
                .replaceAll(" ", "")
                .replaceAll("-", "");
            vehicleIdMatches = vehicleId.includes(sanitizedQuery);
        }
    } catch (error) {
        console.warn("Error processing vehicleId in search:", error);
        vehicleIdMatches = false;
    }

    return (
        tripName.includes(query) ||
        routeName.includes(query) ||
        routeMatches ||
        vehicleIdMatches
    );
}

/** Comparator for sorting trains in the search results. */
export function compareTrains(
    sortBy: TrainSortOption,
    sortDirection: SortDirection,
): (a: TrainFeatureProperties, b: TrainFeatureProperties) => number {
    return (a: TrainFeatureProperties, b: TrainFeatureProperties) => {
        let comparison = 0;

        switch (sortBy) {
            case "number":
                comparison = a.tripShortName.localeCompare(
                    b.tripShortName,
                    undefined,
                    { numeric: true },
                );
                break;
            case "delay":
                comparison = a.delay - b.delay;
                break;
            case "speed":
                comparison = (a.speed ?? 0) - (b.speed ?? 0);
                break;
            default:
                return 0;
        }

        return sortDirection === "asc" ? comparison : -comparison;
    };
}

/** The delay a train shows, or null when it shows none (idle, old data). */
function liveDelay(train: TrainFeatureProperties, now: Date): number | null {
    const display = trainDisplay(train, now);
    return display.state === "running" ? display.delay : null;
}

/**
 * A running train's speed in km/h (the feed has m/s), or null when it is
 * not running its trip or its data is old.
 */
export function liveSpeedKmh(
    train: TrainFeatureProperties,
    now: Date = new Date(),
): number | null {
    if (train.speed == null || trainDisplay(train, now).state !== "running") {
        return null;
    }
    return Math.round(train.speed * 3.6);
}

/**
 * Every train on the map for the browse list. By delay or speed, trains that
 * show neither (waiting, arrived, old data) always sort last. Ties go by
 * number.
 */
export function browseTrains(
    trains: TrainFeatureProperties[],
    sortBy: TrainSortOption,
    direction: SortDirection,
    now: Date = new Date(),
): TrainFeatureProperties[] {
    const byNumber = compareTrains("number", "asc");
    const sign = direction === "asc" ? 1 : -1;
    const key = (p: TrainFeatureProperties): number | null =>
        sortBy === "delay"
            ? liveDelay(p, now)
            : sortBy === "speed"
              ? liveSpeedKmh(p, now)
              : null;
    return trains
        .filter((p) => staleness(p.lastUpdated, now) !== "hidden")
        .map((p) => ({ p, key: key(p) }))
        .sort((a, b) => {
            if (sortBy === "number") return sign * byNumber(a.p, b.p);
            if (a.key === null || b.key === null) {
                if (a.key !== b.key) return a.key === null ? 1 : -1;
                return byNumber(a.p, b.p);
            }
            return sign * (a.key - b.key) || byNumber(a.p, b.p);
        })
        .map(({ p }) => p);
}

/** Live trains past the on-time band (5+ minutes late), latest first. */
export function lateTrains(
    trains: TrainFeatureProperties[],
    limit: number,
    now: Date = new Date(),
): TrainFeatureProperties[] {
    return browseTrains(trains, "delay", "desc", now)
        .filter((p) => {
            const delay = liveDelay(p, now);
            return delay !== null && getDelayLevel(delay) !== "onTime";
        })
        .slice(0, limit);
}
