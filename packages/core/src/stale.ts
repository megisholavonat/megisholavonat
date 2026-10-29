import { STALE_GREY_AFTER_S, STALE_HIDE_AFTER_S } from "./constants";

/** Fresh, grey (stale) or hidden, by the time since the last position update. */
export type Staleness = "fresh" | "stale" | "hidden";

/**
 * Staleness of a train last updated at `lastUpdated` (unix seconds): grey
 * after STALE_GREY_AFTER_S, hidden after STALE_HIDE_AFTER_S. No turf import,
 * so clients can use it on the feed's properties alone.
 */
export function staleness(
    lastUpdated: number,
    now: Date = new Date(),
): Staleness {
    const secondsSinceUpdate = now.getTime() / 1000 - lastUpdated;
    if (secondsSinceUpdate > STALE_HIDE_AFTER_S) return "hidden";
    if (secondsSinceUpdate > STALE_GREY_AFTER_S) return "stale";
    return "fresh";
}

/** Whole minutes since `lastUpdated` (unix seconds), never negative. */
export function minutesSinceUpdate(
    lastUpdated: number,
    now: Date = new Date(),
): number {
    return Math.max(0, Math.floor((now.getTime() / 1000 - lastUpdated) / 60));
}
