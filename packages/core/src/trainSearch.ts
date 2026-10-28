import type { TrainFeatureProperties } from "@megisholavonat/api-client";
import { matchesMavRoute } from "./mavRoutes";
import { normalizeSearchText } from "./search";

export type TrainSortOption = "number" | "delay" | "speed";
export type SortDirection = "asc" | "desc";

/** Whether a train matches the free-text search query (trip/route name, MÁV route icon or UIC number). */
export function matchesTrainQuery(
    result: TrainFeatureProperties,
    searchQuery: string,
): boolean {
    if (!searchQuery.trim()) return true;

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
