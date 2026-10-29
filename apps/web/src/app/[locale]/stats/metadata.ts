import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { OG_SIZE } from "@/lib/og/metadata";
import { siteUrl } from "@/lib/og/server";

/**
 * Title, description and link preview of a stats page, with its own og:url
 * ("Pontosság | Mégis hol a vonat?").
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
    const appTitle = tHome("app_title");
    const ogTitle = title ?? t("title");
    const text = description ?? t("description");
    const image = {
        url: `/${locale}/og`,
        ...OG_SIZE,
        type: "image/png",
        alt: appTitle,
    };
    return {
        metadataBase: new URL(origin),
        title: `${ogTitle} | ${appTitle}`,
        description: text,
        ...(missing ? { robots: { index: false } } : {}),
        alternates: {
            canonical: `${origin}/${locale}${path}`,
            languages: {
                hu: `${origin}/hu${path}`,
                en: `${origin}/en${path}`,
                "x-default": `${origin}/hu${path}`,
            },
        },
        openGraph: {
            type: "website",
            siteName: appTitle,
            locale: locale === "hu" ? "hu_HU" : "en_GB",
            url: `${origin}/${locale}${path}`,
            title: ogTitle,
            description: text,
            images: [image],
        },
        twitter: {
            card: "summary_large_image",
            title: ogTitle,
            description: text,
            images: [image],
        },
    };
}
