import {
    isMapPath,
    mapTarget,
    PLANNER_PARAMS,
    plannerLink,
    plannerSearch,
} from "@megisholavonat/core/links";
import { WEB_URL } from "../config";

/**
 * Where a website link opened in the app goes (iOS Universal Links,
 * Android App Links). Share links look like `/{hu|en}?vehicleId=…` or
 * `?station=…` (shareUrl in core); they open the same sheet over the map as
 * an alert or a `megisholavonat://train/…` link. Any other link to the site
 * opens the map; links that aren't to the site are left as they are.
 */
export function webLinkPath(url: string): string {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return url;
    }
    const site = new URL(WEB_URL);
    if (
        (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
        parsed.hostname !== site.hostname
    ) {
        return url;
    }
    // Only the map page takes these; the locale is the app's own setting
    if (!isMapPath(parsed.pathname)) return "/";
    // Read as the website reads them (core links)
    const target = mapTarget(parsed.searchParams);
    if (target && "vehicleId" in target) {
        return `/train/${encodeURIComponent(target.vehicleId)}`;
    }
    if (target) return `/station/${encodeURIComponent(target.station)}`;
    // A planned journey (`?from=005510017&to=budapest&time=…&arriveBy=1`)
    const journey = plannerLink(parsed.searchParams);
    if (!journey) return "/";
    const search = plannerSearch(journey);
    const query = PLANNER_PARAMS.flatMap((name) =>
        search[name] ? [`${name}=${encodeURIComponent(search[name])}`] : [],
    ).join("&");
    return `/journey?${query}`;
}
