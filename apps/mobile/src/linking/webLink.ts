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
    if (!/^\/((hu|en)\/?)?$/.test(parsed.pathname)) return "/";
    const vehicleId = parsed.searchParams.get("vehicleId");
    if (vehicleId) return `/train/${encodeURIComponent(vehicleId)}`;
    const station = parsed.searchParams.get("station");
    if (station) return `/station/${encodeURIComponent(station)}`;
    // A planned journey (`?from=005510017&to=budapest&time=…&arriveBy=1`)
    const journey = new URLSearchParams();
    for (const name of ["from", "to", "time", "arriveBy"]) {
        const value = parsed.searchParams.get(name);
        if (value) journey.set(name, value);
    }
    if (journey.has("from") || journey.has("to")) {
        return `/journey?${journey.toString()}`;
    }
    return "/";
}
