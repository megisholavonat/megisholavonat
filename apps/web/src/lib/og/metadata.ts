import type { Locale } from "@megisholavonat/core/i18n";
import { ogImagePath, shareUrl } from "@megisholavonat/core/links";
import {
    stationShareText,
    stationShareTitle,
    trainShareText,
} from "@megisholavonat/core/share";
import type { Metadata } from "next";
import {
    type StationCard,
    type TrainCard,
    trainShareInfo,
} from "@/lib/og/model";

export type Preview =
    | { kind: "train"; vehicleId: string; card: TrainCard }
    | { kind: "station"; stationId: string; card: StationCard }
    | { kind: "none" };

export const OG_SIZE = { width: 1200, height: 630 } as const;

/** "10 TRANSCARPATHIA → Záhony" */
export function trainTitle(
    card: Pick<TrainCard, "number" | "name" | "destination">,
): string {
    const name = card.name ? ` ${card.name}` : "";
    return `${card.number}${name} → ${card.destination}`;
}

/** "650 TOKAJ → Budapest-Keleti · Mégis hol a vonat?", or the app's own. */
export function documentTitle(appTitle: string, subject: string | null) {
    return subject ? `${subject} · ${appTitle}` : appTitle;
}

/**
 * Image path of a preview. A minute stamp makes each share fetch a fresh
 * image, since platforms cache og:image by URL.
 */
export function previewImagePath(
    locale: Locale,
    preview: Preview,
    now: Date,
): string {
    const stamp = Math.floor(now.getTime() / 60_000);
    switch (preview.kind) {
        case "train":
            return ogImagePath(locale, { vehicleId: preview.vehicleId }, stamp);
        case "station":
            return ogImagePath(locale, { station: preview.stationId }, stamp);
        default:
            return ogImagePath(locale, null);
    }
}

export interface MetadataInput {
    locale: Locale;
    origin: string;
    appTitle: string;
    appDescription: string;
    preview: Preview;
    now?: Date;
}

/** Title, description and og/twitter tags of a page URL. */
export function buildMetadata({
    locale,
    origin,
    appTitle,
    appDescription,
    preview,
    now = new Date(),
}: MetadataInput): Metadata {
    // Shares send the link alone: these tags are all a chat shows of it
    let title = appTitle;
    /** The preview card's title; the tab keeps the shorter `title` */
    let cardTitle = appTitle;
    let description = appDescription;
    let url = `${origin}/${locale}`;
    if (preview.kind === "train") {
        title = trainTitle(preview.card);
        cardTitle = title;
        description = trainShareText(locale, trainShareInfo(preview.card));
        url = shareUrl(origin, locale, { vehicleId: preview.vehicleId });
    } else if (preview.kind === "station") {
        title = preview.card.name;
        cardTitle = stationShareTitle(locale, preview.card.name);
        description = stationShareText(locale, preview.card.departures);
        url = shareUrl(origin, locale, { station: preview.stationId });
    }
    const image = {
        url: previewImagePath(locale, preview, now),
        ...OG_SIZE,
        type: "image/png",
        alt:
            preview.kind === "none"
                ? appTitle
                : `${cardTitle} – ${description}`,
    };
    return {
        metadataBase: new URL(origin),
        // The tab names the selection too; the map keeps it in step as the
        // selection changes client-side (`documentTitle`)
        title: documentTitle(appTitle, preview.kind === "none" ? null : title),
        description,
        openGraph: {
            type: "website",
            siteName: appTitle,
            locale: locale === "hu" ? "hu_HU" : "en_GB",
            url,
            title: cardTitle,
            description,
            images: [image],
        },
        twitter: {
            card: "summary_large_image",
            title: cardTitle,
            description,
            images: [image],
        },
    };
}

export interface SubpageInput {
    locale: string;
    origin: string;
    appTitle: string;
    /** The page's path under the locale, "/privacy" */
    path: string;
    title: string;
    description: string;
    /** No such page: kept out of search engines */
    missing?: boolean;
}

/**
 * A page of its own (stats, privacy): its own title and og:url, the app's
 * card, and the same title separator as the map ("Pontosság · Mégis hol a
 * vonat?").
 */
export function subpageMetadata({
    locale,
    origin,
    appTitle,
    path,
    title,
    description,
    missing = false,
}: SubpageInput): Metadata {
    const image = {
        url: ogImagePath(locale as Locale, null),
        ...OG_SIZE,
        type: "image/png",
        alt: appTitle,
    };
    return {
        metadataBase: new URL(origin),
        title: documentTitle(appTitle, title),
        description,
        ...(missing ? { robots: { index: false } } : {}),
        openGraph: {
            type: "website",
            siteName: appTitle,
            locale: locale === "hu" ? "hu_HU" : "en_GB",
            url: `${origin}/${locale}${path}`,
            title,
            description,
            images: [image],
        },
        twitter: {
            card: "summary_large_image",
            title,
            description,
            images: [image],
        },
    };
}
