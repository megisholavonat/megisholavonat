import type { Disruption } from "@megisholavonat/api-client";
import type { Interest } from "@megisholavonat/core/disruptions";
import { trainNumber } from "@megisholavonat/core/trainName";
import type { LocalFollow } from "../follow/model";

// Pure helpers for the disruption list (unit tested under Node).

/** The followed trains and their boarding and alighting stations. */
export function interestsOf(follows: readonly LocalFollow[]): Interest[] {
    return follows.map((f) => ({
        trainNumber: trainNumber(f.tripShortName),
        stationIds: [f.stops[f.from]?.stationId, f.stops[f.to]?.stationId],
    }));
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
