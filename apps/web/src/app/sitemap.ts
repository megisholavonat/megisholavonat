import { LOCALES, type Locale } from "@megisholavonat/core/i18n";
import {
    localeAlternates,
    mapPath,
    pageAlternates,
    statsPath,
} from "@megisholavonat/core/links";
import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/og/server";
import { directorySegments, fetchDirectory } from "@/lib/seo/data";

// Rendered per request from the API's directory, which the data cache keeps
// for a day: a build without the API still lists the stations later
export const dynamic = "force-dynamic";

/**
 * The map, the punctuality page, and a page per domestic station with a
 * train on most days and per train number that runs at least weekly, each
 * in both languages.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const origin = siteUrl();
    const directory = await fetchDirectory();
    const entries = (
        languages: Record<Locale, string>,
        extra: Partial<MetadataRoute.Sitemap[number]> = {},
    ) =>
        LOCALES.map((locale) => ({
            url: languages[locale],
            ...extra,
            alternates: {
                languages: Object.fromEntries(
                    LOCALES.map((l) => [l, languages[l]]),
                ),
            },
        }));
    const both = (path: (locale: Locale) => string) =>
        entries(localeAlternates(origin, path));
    const pages = (kind: "station" | "train", key: string) =>
        entries(pageAlternates(origin, kind, key), {
            changeFrequency: "hourly",
        });
    return [
        ...both((locale) => mapPath(locale)),
        ...both(statsPath),
        ...directorySegments(directory.stations).flatMap((segment) =>
            pages("station", segment),
        ),
        ...directory.trains.flatMap((t) => pages("train", t.trainNumber)),
    ];
}
