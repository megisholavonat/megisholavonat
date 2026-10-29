// Server-side checks of a stats page's subject, so an unknown train number
// or station is a 404 rather than an empty page.

import type { StationBoard, TrainHistory } from "@megisholavonat/api-client";
import { apiUrl } from "@/lib/og/server";
import { trainName } from "@/lib/train";

/**
 * An API answer for a stats page: the body, null for a 4xx (no such train
 * or station), undefined when the API could not be asked (the page then
 * renders and loads its data itself).
 */
async function apiAnswer<T>(path: string): Promise<T | null | undefined> {
    try {
        const response = await fetch(`${apiUrl()}${path}`, {
            next: { revalidate: 300 },
            signal: AbortSignal.timeout(4000),
        } as RequestInit);
        if (response.status >= 400 && response.status < 500) return null;
        if (!response.ok) return undefined;
        return (await response.json()) as T;
    } catch {
        return undefined;
    }
}

/**
 * A train's title, "650 TOKAJ", when it has any run on record; null for
 * "abc" or 99999, the bare number when the API could not be asked.
 */
export async function trainTitle(number: string): Promise<string | null> {
    const history = await apiAnswer<TrainHistory>(
        `/v1/history/trains/${encodeURIComponent(number)}`,
    );
    if (history === undefined) return number;
    if (!history || (history.runs === 0 && !history.tripShortName)) {
        return null;
    }
    const name = history.tripShortName
        ? trainName(history.tripShortName)
        : null;
    return name ? `${number} ${name}` : number;
}

/** The station's name; null for an unknown station, undefined unasked. */
export async function stationName(
    id: string,
): Promise<string | null | undefined> {
    const board = await apiAnswer<StationBoard>(
        `/v1/stations/${encodeURIComponent(id)}/departures?limit=1`,
    );
    if (board === undefined) return undefined;
    return board?.station.name ?? null;
}
