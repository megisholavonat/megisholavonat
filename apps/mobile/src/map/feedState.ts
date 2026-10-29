import type { TrainFeatureCollection } from "@megisholavonat/api-client";
import { STALE_GREY_AFTER_S } from "@megisholavonat/core/constants";

// Board "6 · Állapotok" for the map: what the home screen shows besides the
// markers. Pure, unit tested.

export type FeedState =
    | { kind: "loading" }
    | { kind: "offline" }
    /** MÁV sends nothing: since when (unix ms) */
    | { kind: "sourceDown"; sinceMs: number | null }
    | { kind: "empty" }
    /** Trains shown; `staleMinutes` when the whole feed is old */
    | { kind: "ok"; staleMinutes: number | null };

export function feedState(
    data: TrainFeatureCollection | undefined,
    isError: boolean,
    visibleTrains: number,
): FeedState {
    if (!data) return isError ? { kind: "offline" } : { kind: "loading" };

    const age = data.dataAgeMinutes ?? null;
    if (data.noDataReceived) {
        const at = Date.parse(data.timestamp);
        return {
            kind: "sourceDown",
            sinceMs:
                age !== null && Number.isFinite(at) ? at - age * 60_000 : null,
        };
    }
    if (visibleTrains === 0) return { kind: "empty" };
    return {
        kind: "ok",
        staleMinutes:
            age !== null && age * 60 > STALE_GREY_AFTER_S
                ? Math.floor(age)
                : null,
    };
}
