import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { subpageMetadata } from "@/lib/og/metadata";
import { siteUrl } from "@/lib/og/server";

/**
 * Title, description and link preview of a stats page, with its own og:url
 * ("Pontosság · Mégis hol a vonat?").
 */
export async function statsMetadata({
    locale,
    path,
    title,
    description,
    missing = false,
}: {
    locale: string;
    /** The page's path under the locale, "/stats/train/650" */
    path: string;
    title?: string;
    description?: string;
    /** No such train or station: kept out of search engines */
    missing?: boolean;
}): Promise<Metadata> {
    const t = await getTranslations({ locale, namespace: "Stats" });
    const tHome = await getTranslations({ locale, namespace: "Home" });
    const origin = siteUrl();
    return {
        ...subpageMetadata({
            locale,
            origin,
            appTitle: tHome("app_title"),
            path,
            title: title ?? t("title"),
            description: description ?? t("description"),
            missing,
        }),
        alternates: {
            canonical: `${origin}/${locale}${path}`,
            languages: {
                hu: `${origin}/hu${path}`,
                en: `${origin}/en${path}`,
                "x-default": `${origin}/hu${path}`,
            },
        },
    };
}
