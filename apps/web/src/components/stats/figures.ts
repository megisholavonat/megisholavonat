// Pure figures of the punctuality views, shared by the client stats page
// and the server-rendered station and train pages.

import type { HourPunctuality } from "@megisholavonat/api-client";
import { getDelayLevel } from "@megisholavonat/core/delay";

/** Service dates the statistics look back on, as the API defaults to */
export const DEFAULT_DAYS = 28;

/**
 * Fewest samples for a figure, the same as the API's rankings use
 * (`DEFAULT_MIN_SAMPLES`): a station counts passages, a train its runs. A
 * headline, a chart and a list row all follow it, so a page never shows a
 * "10-ből 9" next to "kevés adat" for the same data.
 */
export const MIN_SAMPLES = { stations: 100, lines: 30, trains: 15 } as const;

/** On-time share as whole runs out of ten. */
export function of10(share: number): number {
    return Math.round(share * 10);
}

/**
 * The typical delay as a coarse level, only when the usual run is late
 * (more than 5 minutes); medians are never shown as numbers.
 */
export function lateLevel(medianDelayMin: number | null | undefined) {
    if (medianDelayMin == null) return null;
    const level = getDelayLevel(medianDelayMin);
    return level === "onTime" ? null : level;
}

/** On-time share over all hours, weighted by passages. */
export function overallShare(hours: HourPunctuality[]): {
    share: number;
    n: number;
} | null {
    let n = 0;
    let onTime = 0;
    for (const h of hours) {
        if (h.onTimeShare == null) continue;
        n += h.n;
        onTime += h.onTimeShare * h.n;
    }
    return n > 0 ? { share: onTime / n, n } : null;
}
