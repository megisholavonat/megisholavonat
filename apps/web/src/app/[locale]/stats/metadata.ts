import type { StationBoard, TrainHistory } from "@megisholavonat/api-client";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { OG_SIZE } from "@/lib/og/metadata";
import { apiUrl, siteUrl } from "@/lib/og/server";
import { trainName } from "@/lib/train";

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

/**
 * An API answer for a stats page: the body, null for a 4xx (no such train
 * or station), undefined when the API could not be asked (the page then
 * renders and loads its data itself).
 */
async function apiAnswer<T>(path: string): Promise<T | null | undefined> {
    try {
        const response = await fetch(`${apiUrl()}${path}`, {
            next: { revalidate: 300 },
            signal: AbortSignal.timeout(4000),
        });
        if (response.status >= 400 && response.status < 500) return null;
        if (!response.ok) return undefined;
        return (await response.json()) as T;
    } catch {
        return undefined;
    }
}

/**
 * A train's title, "650 TOKAJ", when it has any run on record; null for
 * "abc" or 99999, the bare number when the API could not be asked.
 */
export async function trainTitle(number: string): Promise<string | null> {
    const history = await apiAnswer<TrainHistory>(
        `/v1/history/trains/${encodeURIComponent(number)}`,
    );
    if (history === undefined) return number;
    if (!history || (history.runs === 0 && !history.tripShortName)) {
        return null;
    }
    const name = history.tripShortName
        ? trainName(history.tripShortName)
        : null;
    return name ? `${number} ${name}` : number;
}

/** The station's name; null for an unknown station, undefined unasked. */
export async function stationName(
    id: string,
): Promise<string | null | undefined> {
    const board = await apiAnswer<StationBoard>(
        `/v1/stations/${encodeURIComponent(id)}/departures?limit=1`,
    );
    if (board === undefined) return undefined;
    return board?.station.name ?? null;
}
