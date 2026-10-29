import type { Locale } from "@megisholavonat/core/i18n";
import {
    shareUrl,
    stationShareText,
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

/** Which preview a page URL asks for: `?vehicleId=` wins over `?station=`. */
export function previewTarget(
    search: string | URLSearchParams,
): { vehicleId: string } | { station: string } | null {
    const params =
        typeof search === "string" ? new URLSearchParams(search) : search;
    const vehicleId = params.get("vehicleId")?.trim();
    if (vehicleId) return { vehicleId };
    const station = params.get("station")?.trim();
    if (station) return { station };
    return null;
}

/** "10 TRANSCARPATHIA → Záhony" */
export function trainTitle(card: TrainCard): string {
    const name = card.name ? ` ${card.name}` : "";
    return `${card.number}${name} → ${card.destination}`;
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
    const stamp = `?v=${Math.floor(now.getTime() / 60_000)}`;
    switch (preview.kind) {
        case "train":
            return `/${locale}/og/train/${encodeURIComponent(preview.vehicleId)}${stamp}`;
        case "station":
            return `/${locale}/og/station/${encodeURIComponent(preview.stationId)}${stamp}`;
        default:
            return `/${locale}/og`;
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
    let title = appTitle;
    let description = appDescription;
    let url = `${origin}/${locale}`;
    if (preview.kind === "train") {
        title = trainTitle(preview.card);
        description = trainShareText(locale, trainShareInfo(preview.card));
        url = shareUrl(origin, locale, { vehicleId: preview.vehicleId });
    } else if (preview.kind === "station") {
        title = preview.card.name;
        description = stationShareText(locale, preview.card.departures);
        url = shareUrl(origin, locale, { station: preview.stationId });
    }
    const image = {
        url: previewImagePath(locale, preview, now),
        ...OG_SIZE,
        type: "image/png",
        alt: preview.kind === "none" ? appTitle : `${title} – ${description}`,
    };
    return {
        metadataBase: new URL(origin),
        // The tab title stays the app's: the selection changes client-side
        title: appTitle,
        description,
        openGraph: {
            type: "website",
            siteName: appTitle,
            locale: locale === "hu" ? "hu_HU" : "en_GB",
            url,
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
