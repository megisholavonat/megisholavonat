import type { Station } from "@megisholavonat/api-client";

/**
 * What a stop is, as the API's station index classifies it from the routes
 * serving it (apps/api/api/util/stop.py): a railway station or halt, a HÉV
 * stop, a stop of the Szeged-Hódmezővásárhely tram-train or a station of the
 * Children's Railway.
 */
export type StationType = NonNullable<Station["type"]>;

export const STATION_TYPES: readonly StationType[] = [
    "rail",
    "hev",
    "tramtrain",
    "childrens_railway",
];

/** The type of a station; stations saved before types existed are rail. */
export function stationType(station: { type?: StationType | null }) {
    return station.type ?? "rail";
}

/** Not a railway station: shown with its own mark and label. */
export function isOtherStop(station: { type?: StationType | null }): boolean {
    return stationType(station) !== "rail";
}
