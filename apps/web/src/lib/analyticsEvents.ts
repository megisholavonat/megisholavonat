import type { Itinerary } from "@megisholavonat/api-client";
import type {
    AnalyticsEvent,
    EventProps,
} from "@megisholavonat/core/analytics";
import { getDelayLevel } from "@megisholavonat/core/delay";
import { useEffect, useRef } from "react";
import { worstTransfer } from "@/components/journey/journey";
import { analytics, track } from "@/lib/analytics";

// Helpers that keep the instrumentation in components to one line each.

type Entry = NonNullable<EventProps<"train_opened">["entry"]>;

let pending: { entry: Entry; at: number } | null = null;

/** Where the next train or station opening comes from (for a few seconds). */
export function noteEntry(entry: Entry) {
    pending = { entry, at: Date.now() };
}

/** The entry noted for the opening happening now, if it is recent. */
export function takeEntry(): Entry | null {
    const noted = pending;
    pending = null;
    return noted && Date.now() - noted.at < 10_000 ? noted.entry : null;
}

export function boardRowOpened(
    board: "departures" | "arrivals",
    position: number,
) {
    noteEntry("board");
    track("board_row_opened", { board, position });
}

export function commuteRowOpened(
    position: number,
    live: { delay?: number | null; stale?: boolean | null } | null,
) {
    noteEntry("commute");
    track("commute_row_opened", {
        position,
        delay_level: !live
            ? "unknown"
            : live.stale
              ? "stale"
              : getDelayLevel(live.delay ?? 0),
    });
}

export function plannerResultExpanded(position: number, itinerary: Itinerary) {
    track("planner_result_expanded", {
        position,
        transfers: itinerary.transfers.length,
        max_risk: worstTransfer(itinerary.transfers)?.risk ?? "none",
    });
}

/** Once per search (from, to, time), when its first answer arrives. */
export function usePlannerSearched(
    key: string,
    plan: {
        isFetching: boolean;
        isPlaceholderData: boolean;
        isError: boolean;
        data?: { itineraries: unknown[] };
    },
    departureSet: boolean,
    enabled: boolean,
) {
    const sent = useRef<string | null>(null);
    const settled = !plan.isFetching && !plan.isPlaceholderData;
    useEffect(() => {
        if (!enabled || !settled || sent.current === key) return;
        sent.current = key;
        track("planner_searched", {
            results: plan.data?.itineraries.length ?? 0,
            departure_set: departureSet,
            error: plan.isError,
        });
    }, [enabled, settled, key, plan.data, plan.isError, departureSet]);
}

/**
 * Sends an event when a view shows, and again when `props` change; fast
 * changes (tabs, toggles) count once.
 */
export function useTrackView<E extends AnalyticsEvent>(
    event: E,
    props: EventProps<E>,
) {
    const key = JSON.stringify(props);
    // biome-ignore lint/correctness/useExhaustiveDependencies: props by value
    useEffect(() => {
        analytics.trackDebounced(event, props, 800, event);
    }, [event, key]);
}
