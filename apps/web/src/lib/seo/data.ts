// Server-side data of the station and train pages, from the API at
// `API_URL`. Every request goes through Next's data cache, so crawlers
// fetching many pages do not reach the API more than once per window.

import type {
    Directory,
    Station,
    StationBoard,
    TimeOfDayPunctuality,
    TrainFeatureCollection,
    TrainHistory,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";
import { apiUrl } from "@/lib/og/server";
import { trainNumber } from "@/lib/train";
import { parseStationSegment, stationSegment, stationSlug } from "./paths";

/** Seconds each kind of data is reused for */
export const REVALIDATE = {
    /** Boards and live trains */
    live: 60,
    /** Delay history */
    history: 30 * 60,
    /** Station names, the sitemap's lists */
    names: 24 * 60 * 60,
} as const;

/** The API answered with an error or not at all: the page is a 500. */
export class ApiUnavailableError extends Error {}

/**
 * GET an API path: the body, null for a 4xx (no such station or train).
 * Throws when the API fails, so a page is never an empty 200.
 */
export async function apiGet<T>(
    path: string,
    revalidate: number,
): Promise<T | null> {
    let response: Response;
    try {
        response = await fetch(`${apiUrl()}${path}`, {
            next: { revalidate },
            signal: AbortSignal.timeout(5000),
        });
    } catch (error) {
        throw new ApiUnavailableError(`${path}: ${String(error)}`);
    }
    if (response.status >= 400 && response.status < 500) return null;
    if (!response.ok) {
        throw new ApiUnavailableError(`${path}: ${response.status}`);
    }
    return (await response.json()) as T;
}

/** The same, null when the API fails too: for the optional parts of a page. */
export async function apiTry<T>(
    path: string,
    revalidate: number,
): Promise<T | null> {
    try {
        return await apiGet<T>(path, revalidate);
    } catch {
        return null;
    }
}

const enc = encodeURIComponent;

/** Stations whose name has this slug, domestic ones first (search order). */
export async function stationsWithSlug(slug: string): Promise<Station[]> {
    if (!slug) return [];
    const found = await apiGet<Station[]>(
        `/v1/stations?q=${enc(slug.replace(/-/g, " "))}&limit=50`,
        REVALIDATE.names,
    );
    return (found ?? []).filter((s) => stationSlug(s.name) === slug);
}

/** Departure or arrival board, as the station page shows it. */
export function fetchStationBoard(
    stationId: string,
    kind: "departures" | "arrivals",
): Promise<StationBoard | null> {
    return apiGet(
        `/v1/stations/${enc(stationId)}/departures?kind=${kind}&limit=12`,
        REVALIDATE.live,
    );
}

/**
 * The segment a station's page lives at: the bare slug for the first station
 * of that name in search order (domestic first, then by id), the slug with
 * its id for any other ("buk-005102723").
 */
export async function canonicalStationSegment(
    station: Pick<Station, "id" | "name">,
): Promise<string> {
    const same = await stationsWithSlug(stationSlug(station.name));
    return stationSegment(station, same[0]?.id !== station.id);
}

/**
 * Segments of the sitemap's stations, by the same rule without asking the
 * search: of the listed stations sharing a slug, the lowest id keeps it.
 */
export function directorySegments(
    stations: Pick<Station, "id" | "name">[],
): string[] {
    const owner = new Map<string, string>();
    for (const s of [...stations].sort((a, b) => a.id.localeCompare(b.id))) {
        const slug = stationSlug(s.name);
        if (!owner.has(slug)) owner.set(slug, s.id);
    }
    return stations.map((s) =>
        stationSegment(s, owner.get(stationSlug(s.name)) !== s.id),
    );
}

export type StationLookup =
    | { kind: "found"; station: Station; segment: string }
    | { kind: "redirect"; segment: string }
    | { kind: "missing" };

/**
 * The station a path segment names. A segment that is not the canonical
 * one ("Budapest-Keleti", "005510017", a shared slug) redirects to it.
 */
export async function lookupStation(segment: string): Promise<StationLookup> {
    const { slug, id } = parseStationSegment(segment);
    if (id) {
        const board = await fetchStationBoard(id, "departures");
        if (!board) return { kind: "missing" };
        const canonical = await canonicalStationSegment(board.station);
        return canonical === segment
            ? { kind: "found", station: board.station, segment }
            : { kind: "redirect", segment: canonical };
    }
    const wanted = stationSlug(slug);
    const same = await stationsWithSlug(wanted);
    const first = same[0];
    if (!first) return { kind: "missing" };
    // A shared name is the first (domestic) station of that name
    const canonical = stationSegment(first, false);
    return canonical === segment
        ? { kind: "found", station: first, segment }
        : { kind: "redirect", segment: canonical };
}

export function fetchTimeOfDay(
    stationId: string,
): Promise<TimeOfDayPunctuality | null> {
    return apiTry(
        `/v1/rankings/time-of-day?stationId=${enc(stationId)}`,
        REVALIDATE.history,
    );
}

/** A train number as it can appear in the data: "10", "2619", "H8000". */
export function isTrainNumber(value: string): boolean {
    return /^[\p{L}\p{N}]{1,10}$/u.test(value);
}

export interface TrainPageData {
    history: TrainHistory | null;
    /** Today's run on the map, when there is one */
    vehicle: VehiclePositionWithDelay | null;
}

/** The live vehicle running as this train number, fresh ones first. */
export async function liveVehicleId(number: string): Promise<string | null> {
    const feed = await apiTry<TrainFeatureCollection>(
        "/v1/trains",
        REVALIDATE.live,
    );
    const matches = (feed?.features ?? [])
        .map((f) => f.properties)
        .filter((p) => trainNumber(p.tripShortName ?? "") === number)
        .sort((a, b) => Number(!!a.isStale) - Number(!!b.isStale));
    return matches[0]?.vehicleId ?? null;
}

/**
 * History and today's run of a train number; null for a number that has
 * neither ("abc", 99999).
 */
export async function fetchTrainPage(
    number: string,
): Promise<TrainPageData | null> {
    if (!isTrainNumber(number)) return null;
    const [history, vehicleId] = await Promise.all([
        apiGet<TrainHistory>(
            `/v1/history/trains/${enc(number)}`,
            REVALIDATE.history,
        ),
        liveVehicleId(number),
    ]);
    const vehicle = vehicleId
        ? await apiTry<VehiclePositionWithDelay>(
              `/v1/trains/${enc(vehicleId)}`,
              REVALIDATE.live,
          )
        : null;
    const known = !!history && (history.runs > 0 || !!history.tripShortName);
    if (!known && !vehicle) return null;
    return { history: known ? history : null, vehicle };
}

/** Stations and train numbers for the sitemap; empty when unavailable. */
export async function fetchDirectory(): Promise<Directory> {
    const directory = await apiTry<Directory>(
        "/v1/history/directory",
        REVALIDATE.names,
    );
    return (
        directory ?? {
            window: { start: "", end: "", days: 0 },
            stations: [],
            trains: [],
        }
    );
}
