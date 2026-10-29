import type {
    StationBoard,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";
import { SITE_URL } from "@megisholavonat/core/share";

/** Request header the proxy copies the page's query string into. */
export const SEARCH_HEADER = "x-mhav-search";

/** Delays change by the minute: previews are cached for this long at most. */
export const PREVIEW_MAX_AGE = 60;

/** Public origin of the request, "https://megisholavonat.info". */
export function requestOrigin(headers: Headers): string {
    const host = headers.get("x-forwarded-host") ?? headers.get("host");
    if (!host) return SITE_URL;
    const proto =
        headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
        (/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https");
    return `${proto}://${host}`;
}

/** API base for server-side requests. Behind the ingress the API is /api. */
function apiBase(origin: string): string {
    return (process.env.API_URL ?? `${origin}/api`).replace(/\/$/, "");
}

async function getJson<T>(origin: string, path: string): Promise<T | null> {
    try {
        const response = await fetch(`${apiBase(origin)}${path}`, {
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
    origin: string,
    vehicleId: string,
): Promise<VehiclePositionWithDelay | null> {
    return getJson(origin, `/v1/trains/${encodeURIComponent(vehicleId)}`);
}

export function fetchBoard(
    origin: string,
    stationId: string,
): Promise<StationBoard | null> {
    return getJson(
        origin,
        `/v1/stations/${encodeURIComponent(stationId)}/departures?kind=departures&limit=4`,
    );
}
