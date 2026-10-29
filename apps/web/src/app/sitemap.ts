import { LOCALES } from "@megisholavonat/core/i18n";
import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/og/server";
import { directorySegments, fetchDirectory } from "@/lib/seo/data";
import { pageAlternates } from "@/lib/seo/paths";

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
    const both = (path: string) =>
        LOCALES.map((locale) => ({
            url: `${origin}/${locale}${path}`,
            alternates: {
                languages: Object.fromEntries(
                    LOCALES.map((l) => [l, `${origin}/${l}${path}`]),
                ),
            },
        }));
    const pages = (kind: "station" | "train", key: string) => {
        const languages = pageAlternates(origin, kind, key);
        return LOCALES.map((locale) => ({
            url: languages[locale],
            changeFrequency: "hourly" as const,
            alternates: {
                languages: Object.fromEntries(
                    LOCALES.map((l) => [l, languages[l]]),
                ),
            },
        }));
    };
    return [
        ...both(""),
        ...both("/stats"),
        ...directorySegments(directory.stations).flatMap((segment) =>
            pages("station", segment),
        ),
        ...directory.trains.flatMap((t) => pages("train", t.trainNumber)),
    ];
}
