import type {
    StationBoard,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";
import { SITE_URL } from "@megisholavonat/core/share";

/** Request header the proxy copies the page's query string into. */
export const SEARCH_HEADER = "x-mhav-search";

/** Delays change by the minute: previews are cached for this long at most. */
export const PREVIEW_MAX_AGE = 60;

/** The API when `API_URL` is not set: a local dev server. */
export const DEV_API_URL = "http://localhost:8000";

type Env = Partial<Record<string, string>>;

/** An http(s) URL from the environment without its trailing slash. */
function envUrl(value: string | undefined, fallback: string): string {
    if (!value) return fallback;
    try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return fallback;
        }
        return url.href.replace(/\/+$/, "");
    } catch {
        return fallback;
    }
}

/**
 * Public origin of the site, "https://megisholavonat.info", from `SITE_URL`.
 * Never taken from request headers: og:url and metadataBase would echo any
 * Host a client sends.
 */
export function siteUrl(env: Env = process.env): string {
    return new URL(envUrl(env.SITE_URL, SITE_URL)).origin;
}

/**
 * API base for server-side requests, from `API_URL` (in production the
 * in-cluster service). Never built from Host / X-Forwarded-Host, which would
 * let a client point the server's requests anywhere.
 */
export function apiUrl(env: Env = process.env): string {
    return envUrl(env.API_URL, DEV_API_URL);
}

async function getJson<T>(path: string): Promise<T | null> {
    try {
        const response = await fetch(`${apiUrl()}${path}`, {
            next: { revalidate: 30 },
            signal: AbortSignal.timeout(4000),
        });
        if (!response.ok) return null;
        return (await response.json()) as T;
    } catch {
        return null;
    }
}

export function fetchTrain(
    vehicleId: string,
): Promise<VehiclePositionWithDelay | null> {
    return getJson(`/v1/trains/${encodeURIComponent(vehicleId)}`);
}

export function fetchBoard(stationId: string): Promise<StationBoard | null> {
    return getJson(
        `/v1/stations/${encodeURIComponent(stationId)}/departures?kind=departures&limit=4`,
    );
}
