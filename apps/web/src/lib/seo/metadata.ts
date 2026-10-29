// Metadata and structured data of the station and train pages.

import type { Locale } from "@megisholavonat/core/i18n";
import { huTrainSubject } from "@megisholavonat/core/share";
import type { Metadata } from "next";
import { documentTitle, OG_SIZE } from "@/lib/og/metadata";
import { type PageKind, pageAlternates } from "./paths";

/** "10-es vonat", "Train 10" */
export function trainSubject(locale: Locale, number: string): string {
    return locale === "hu"
        ? huTrainSubject(number).replace(/^Az? /, "")
        : `Train ${number}`;
}

export interface SeoPageInput {
    locale: Locale;
    origin: string;
    appTitle: string;
    kind: PageKind;
    /** Canonical path segment: the station slug or the train number */
    segment: string;
    title: string;
    description: string;
    /** og:image path under the origin ("/hu/og/station/005510017") */
    image: string;
    imageAlt: string;
}

/**
 * Title, description, canonical URL with its language versions, and the
 * link preview of a station or train page.
 */
export function seoMetadata(input: SeoPageInput): Metadata {
    const languages = pageAlternates(input.origin, input.kind, input.segment);
    const url = languages[input.locale];
    const image = {
        url: input.image,
        ...OG_SIZE,
        type: "image/png",
        alt: input.imageAlt,
    };
    return {
        metadataBase: new URL(input.origin),
        title: documentTitle(input.appTitle, input.title),
        description: input.description,
        alternates: { canonical: url, languages },
        openGraph: {
            type: "website",
            siteName: input.appTitle,
            locale: input.locale === "hu" ? "hu_HU" : "en_GB",
            url,
            title: input.title,
            description: input.description,
            images: [image],
        },
        twitter: {
            card: "summary_large_image",
            title: input.title,
            description: input.description,
            images: [image],
        },
    };
}

/** Breadcrumbs from the app's home to the page, as schema.org data. */
export function breadcrumbs(
    items: { name: string; url: string }[],
): Record<string, unknown> {
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: items.map((item, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: item.name,
            item: item.url,
        })),
    };
}

/**
 * JSON for a `<script type="application/ld+json">`: "<" escaped, so a name
 * can never close the script element.
 */
export function jsonLd(data: unknown): string {
    return JSON.stringify(data).replace(/</g, "\\u003c");
}
