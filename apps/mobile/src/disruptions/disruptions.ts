import type { Disruption } from "@megisholavonat/api-client";
import type { Interest } from "@megisholavonat/core/disruptions";
import type { LocalFollow } from "../follow/model";

// Pure helpers for the disruption list (unit tested under Node).

/** The followed trains and their boarding and alighting stations. */
export function interestsOf(follows: readonly LocalFollow[]): Interest[] {
    return follows.map((f) => ({
        trainNumber: f.tripShortName.trim().split(/\s+/)[0] ?? null,
        stationIds: [f.stops[f.from]?.stationId, f.stops[f.to]?.stationId],
    }));
}

/** Validity in whole days, or with times within one day. */
export function validityFormat(d: Disruption): Intl.DateTimeFormatOptions {
    const short = d.start != null && d.end != null && d.end - d.start < 86_400;
    return short
        ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
        : { month: "short", day: "numeric" };
}

/** MÁV's texts, blank lines squeezed. */
export function fullTexts(d: Disruption): string[] {
    return [d.description, ...d.details]
        .map((text) =>
            text
                .replace(/[ \t]+\n/g, "\n")
                .replace(/\n{2,}/g, "\n")
                .trim(),
        )
        .filter(Boolean);
}
