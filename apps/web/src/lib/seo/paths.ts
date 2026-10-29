// Stable, crawlable addresses of station and train pages: Hungarian and
// English path segments, with the station's name as its slug.

import { LOCALES, type Locale } from "@megisholavonat/core/i18n";

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
    const languages = Object.fromEntries(
        LOCALES.map((locale) => [locale, `${origin}${path(locale)}`]),
    ) as Record<Locale, string>;
    return { ...languages, "x-default": languages.hu };
}
