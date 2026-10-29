/**
 * Every address of the app, in one place: the map with a train or station
 * open, the station and train pages, the delay card, stats, link preview
 * images and planner links. Pages build their links here, and the web and
 * the apps read shared links back with the same rules.
 */

import { isStationId } from "./delaySummary";
import { LOCALES, type Locale } from "./i18n";

/** Public origin of the site. */
export const SITE_URL = "https://megisholavonat.info";

const trimOrigin = (origin: string) => origin.replace(/\/$/, "");

// --- The map -------------------------------------------------------------

/** What a map link opens: a train or a station's board. */
export type MapTarget = { vehicleId: string } | { station: string };

/** Query parameters the map reads its selection from. */
export const MAP_PARAMS = ["vehicleId", "station"] as const;

/** Paths of the map page: "/", "/hu", "/en". */
export const MAP_PATHS = ["/", ...LOCALES.map((locale) => `/${locale}`)];

/** Whether a path is the map page ("/", "/hu", "/en/"). */
export function isMapPath(pathname: string): boolean {
    const path = pathname.replace(/(.)\/$/, "$1");
    return MAP_PATHS.includes(path);
}

/** "/hu", "/hu?vehicleId=1%3A42", "/en?station=005510017" */
export function mapPath(locale: Locale, target?: MapTarget | null): string {
    if (!target) return `/${locale}`;
    const [key, value] =
        "vehicleId" in target
            ? ["vehicleId", target.vehicleId]
            : ["station", target.station];
    return `/${locale}?${key}=${encodeURIComponent(value)}`;
}

/** Link that opens a train or a station on the map, on `origin`. */
export function shareUrl(
    origin: string,
    locale: Locale,
    target: MapTarget,
): string {
    return `${trimOrigin(origin)}${mapPath(locale, target)}`;
}

/** Query parameters as read: a URLSearchParams, or any lookup by name. */
export interface QueryParams {
    get(name: string): string | null | undefined;
}

/**
 * The train and the station a map URL names, trimmed; blank is none. Both
 * can be set: a train opened over a station's board.
 */
export function mapParams(params: QueryParams): {
    vehicleId: string | null;
    station: string | null;
} {
    const read = (name: string) => params.get(name)?.trim() || null;
    return { vehicleId: read("vehicleId"), station: read("station") };
}

/** What a shared map link opens: the train wins over the station. */
export function mapTarget(params: QueryParams): MapTarget | null {
    const { vehicleId, station } = mapParams(params);
    if (vehicleId) return { vehicleId };
    if (station) return { station };
    return null;
}

// --- Station and train pages ----------------------------------------------

export type PageKind = "station" | "train";

/** Path segment of each page kind, per language: /hu/allomas, /en/station */
export const SEGMENTS: Record<Locale, Record<PageKind, string>> = {
    hu: { station: "allomas", train: "vonat" },
    en: { station: "station", train: "train" },
};

/**
 * A station name as a URL slug: accents folded, lower case, anything else
 * than letters and digits a single dash ("Budapest-Keleti" ->
 * "budapest-keleti", "Szeged-Rókus" -> "szeged-rokus"). The same folding as
 * the API's station search, so a slug read back as words finds the station.
 */
export function stationSlug(name: string): string {
    return name
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/[^0-9a-z]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/** The station search query a slug stands for ("budapest keleti"). */
export function slugQuery(slug: string): string {
    return slug.replace(/-/g, " ");
}

/**
 * A station path segment: the bare slug, or the slug with the station's UIC
 * code when another station shares the name ("buk-005102723"), or the bare
 * code ("005510017", redirected to the slug).
 */
export function parseStationSegment(segment: string): {
    slug: string;
    id: string | null;
} {
    const match = segment.match(/^(?:(.+)-)?(\d{6,})$/);
    return match
        ? { slug: match[1] ?? "", id: match[2] }
        : { slug: segment, id: null };
}

/** The segment of a station: its slug, with its id when the slug is shared. */
export function stationSegment(
    station: { id: string; name: string },
    shared: boolean,
): string {
    const slug = stationSlug(station.name) || station.id;
    return shared ? `${slug}-${station.id}` : slug;
}

/** "/hu/allomas/budapest-keleti" */
export function stationPath(locale: Locale, segment: string): string {
    return `/${locale}/${SEGMENTS[locale].station}/${encodeURIComponent(segment)}`;
}

/** "/hu/vonat/10" */
export function trainPath(locale: Locale, number: string): string {
    return `/${locale}/${SEGMENTS[locale].train}/${encodeURIComponent(number)}`;
}

/**
 * Link to a station's page from the app, which knows its id and name but
 * not whether the name is shared: the bare slug, which leads to the
 * domestic station of that name (the page redirects a shared one).
 */
export function stationHref(
    locale: Locale,
    station: { id: string; name: string },
): string {
    return stationPath(locale, stationSegment(station, false));
}

/** The same page in every language, for hreflang alternates. */
export function pageAlternates(
    origin: string,
    kind: PageKind,
    key: string,
): Record<Locale | "x-default", string> {
    const path = (locale: Locale) =>
        kind === "station" ? stationPath(locale, key) : trainPath(locale, key);
    return localeAlternates(origin, path);
}

/** One path in every language, for hreflang alternates. */
export function localeAlternates(
    origin: string,
    path: (locale: Locale) => string,
): Record<Locale | "x-default", string> {
    const languages = Object.fromEntries(
        LOCALES.map((locale) => [
            locale,
            `${trimOrigin(origin)}${path(locale)}`,
        ]),
    ) as Record<Locale, string>;
    return { ...languages, "x-default": languages.hu };
}

// --- Other pages -----------------------------------------------------------

/** "/hu/stats": punctuality overview */
export function statsPath(locale: Locale): string {
    return `/${locale}/stats`;
}

/** "/hu/privacy" */
export function privacyPath(locale: Locale): string {
    return `/${locale}/privacy`;
}

/** Path segment of the delay card page, in both locales (the link is stable). */
export const DELAY_SUMMARY_SEGMENT = "kesesek";

/** The boarding and alighting stations a card is about (UIC codes). */
export interface RunStops {
    from?: string | null;
    to?: string | null;
}

/** "?from=005513748&to=005510033", or "" */
function runSearch(stops: RunStops): string {
    // Station ids are digits only: nothing to encode
    const search = [
        isStationId(stops.from) ? `from=${stops.from}` : null,
        isStationId(stops.to) ? `to=${stops.to}` : null,
    ]
        .filter(Boolean)
        .join("&");
    return search ? `?${search}` : "";
}

/** "/hu/kesesek/2614/2026-10-29?from=005513748&to=005510033" */
export function delaySummaryPath(
    locale: Locale,
    number: string,
    date: string,
    stops: RunStops = {},
): string {
    return `/${locale}/${DELAY_SUMMARY_SEGMENT}/${encodeURIComponent(number)}/${date}${runSearch(stops)}`;
}

/** The card link on `origin` (the site's own, never a request header). */
export function delaySummaryUrl(
    origin: string,
    locale: Locale,
    number: string,
    date: string,
    stops: RunStops = {},
): string {
    return `${trimOrigin(origin)}${delaySummaryPath(locale, number, date, stops)}`;
}

// --- Link preview images ----------------------------------------------------

/** What a link preview image shows; none is the app's own card. */
export type OgImage =
    | { vehicleId: string }
    | { station: string }
    | { run: { number: string; date: string; stops?: RunStops } }
    | null;

/**
 * "/hu/og/train/1%3A42", "/hu/og/station/005510017",
 * "/hu/og/run/2614/2026-10-29?from=…", "/hu/og". A `stamp` (a minute
 * count) makes each share fetch a fresh image, since platforms cache
 * og:image by URL.
 */
export function ogImagePath(
    locale: Locale,
    image: OgImage,
    stamp?: number,
): string {
    const base = `/${locale}/og`;
    let path = base;
    let search = "";
    if (image && "vehicleId" in image) {
        path = `${base}/train/${encodeURIComponent(image.vehicleId)}`;
    } else if (image && "station" in image) {
        path = `${base}/station/${encodeURIComponent(image.station)}`;
    } else if (image) {
        const { number, date, stops = {} } = image.run;
        path = `${base}/run/${encodeURIComponent(number)}/${date}`;
        search = runSearch(stops);
    }
    if (stamp !== undefined && path !== base) {
        search += `${search ? "&" : "?"}v=${stamp}`;
    }
    return `${path}${search}`;
}

// --- Planner links -----------------------------------------------------------

/** The planner's query parameters, so a planned journey can be shared */
export const PLANNER_PARAMS = ["from", "to", "time", "arriveBy"] as const;
export type PlannerParam = (typeof PLANNER_PARAMS)[number];

/** A UIC code or "budapest" (any Budapest station) */
const PLANNER_STATION = /^(\d{9}|budapest)$/;
/** Local Budapest time, "2026-10-30T07:00" */
const PLANNER_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * The journey a planner link names: `?from=005510017&to=budapest&time=
 * 2026-10-30T07:00&arriveBy=1`, a UIC code or `budapest` at either end.
 * Anything else is dropped; arriving by needs a set time. Null when it
 * names neither end.
 */
export function plannerLink(params: QueryParams): {
    from: string | null;
    to: string | null;
    time: string | null;
    arriveBy: boolean;
} | null {
    const station = (name: "from" | "to") => {
        const id = params.get(name)?.trim();
        return id && PLANNER_STATION.test(id) ? id : null;
    };
    const from = station("from");
    const to = station("to");
    if (!from && !to) return null;
    const param = params.get("time")?.trim();
    const time = param && PLANNER_TIME.test(param) ? param : null;
    return {
        from,
        to,
        time,
        // Arriving by is a set time's ("now" only departs)
        arriveBy: time !== null && params.get("arriveBy") === "1",
    };
}

/** A planned journey as query parameters (the inverse of `plannerLink`). */
export function plannerSearch(journey: {
    from: string | null;
    to: string | null;
    time: string | null;
    arriveBy: boolean;
}): Partial<Record<PlannerParam, string>> {
    const params: Partial<Record<PlannerParam, string>> = {};
    if (journey.from) params.from = journey.from;
    if (journey.to) params.to = journey.to;
    if (journey.time) params.time = journey.time;
    if (journey.time && journey.arriveBy) params.arriveBy = "1";
    return params;
}
