import {
    isRunDate,
    isStationId,
    isTrainNumber,
    type RunStops,
} from "@megisholavonat/core/delaySummary";
import { decodeParam } from "@/lib/utils";

export interface RunParams {
    number: string;
    date: string;
    stops: RunStops;
}

type Search = Record<string, string | string[] | undefined> | URLSearchParams;

function one(search: Search, key: string): string | null {
    const value =
        search instanceof URLSearchParams ? search.get(key) : search[key];
    return typeof value === "string" ? value : null;
}

/**
 * A card link's run: null for a malformed number or date (a 404). Stops
 * that are not station codes are dropped, so a mangled link still shows
 * the run.
 */
export function runParams(
    rawNumber: string,
    rawDate: string,
    search: Search,
): RunParams | null {
    const number = decodeParam(rawNumber);
    const date = decodeParam(rawDate);
    if (!isTrainNumber(number) || !isRunDate(date)) return null;
    const from = one(search, "from");
    const to = one(search, "to");
    return {
        number,
        date,
        stops: {
            from: isStationId(from) ? from : null,
            to: isStationId(to) ? to : null,
        },
    };
}
