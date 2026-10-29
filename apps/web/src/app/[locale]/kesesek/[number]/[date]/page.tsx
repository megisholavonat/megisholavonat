import {
    delaySummary,
    delaySummarySentence,
    MEASUREMENT_NOTE,
} from "@megisholavonat/core/delaySummary";
import type { Locale } from "@megisholavonat/core/i18n";
import {
    delaySummaryUrl,
    type MapTarget,
    mapPath,
    ogImagePath,
    trainPath,
} from "@megisholavonat/core/links";
import { ChartColumn, Info, Map as MapIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/seo/PageHeader";
import { PageMain } from "@/components/seo/PageMain";
import { Button } from "@/components/ui/Button";
import { routing } from "@/i18n/routing";
import { OG_SIZE } from "@/lib/og/metadata";
import { type RunParams, runParams } from "@/lib/og/runParams";
import { fetchRun, siteUrl } from "@/lib/og/server";
import { liveVehicleId } from "@/lib/seo/data";

type Params = Promise<{ locale: string; number: string; date: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

async function load(params: Params, searchParams: Search) {
    const { locale: raw, number, date } = await params;
    const locale: Locale = hasLocale(routing.locales, raw)
        ? raw
        : routing.defaultLocale;
    const run = runParams(number, date, await searchParams);
    if (!run) return { locale, run: null, card: null };
    const summary = await fetchRun(run.number, run.date, run.stops.from);
    if (summary === undefined) {
        // The API could not be asked: an error, not a missing run
        throw new Error("Run summary unavailable");
    }
    return {
        locale,
        run,
        card: summary ? delaySummary(summary, run.stops) : null,
    };
}

function imagePath(locale: Locale, run: RunParams): string {
    return ogImagePath(locale, { run });
}

export async function generateMetadata({
    params,
    searchParams,
}: {
    params: Params;
    searchParams: Search;
}): Promise<Metadata> {
    const { locale, run, card } = await load(params, searchParams);
    const t = await getTranslations({ locale, namespace: "DelayCard" });
    const tHome = await getTranslations({ locale, namespace: "Home" });
    const appTitle = tHome("app_title");
    if (!run || !card) {
        return {
            title: `${t("not_found")} | ${appTitle}`,
            robots: { index: false },
        };
    }
    const origin = siteUrl();
    const sentence = delaySummarySentence(locale, card);
    const description = `${sentence}. ${MEASUREMENT_NOTE[locale]}.`;
    const image = {
        url: imagePath(locale, run),
        ...OG_SIZE,
        type: "image/png",
        alt: t("image_alt", { sentence }),
    };
    return {
        metadataBase: new URL(origin),
        title: `${sentence} | ${appTitle}`,
        description,
        // One run's card: worth sharing, not worth indexing
        robots: { index: false },
        openGraph: {
            type: "website",
            siteName: appTitle,
            locale: locale === "hu" ? "hu_HU" : "en_GB",
            url: delaySummaryUrl(
                origin,
                locale,
                run.number,
                run.date,
                run.stops,
            ),
            title: sentence,
            description: MEASUREMENT_NOTE[locale],
            images: [image],
        },
        twitter: {
            card: "summary_large_image",
            title: sentence,
            description: MEASUREMENT_NOTE[locale],
            images: [image],
        },
    };
}

/**
 * Where the card's map button goes. The map opens a train only while it
 * runs: today's run of this number when there is one, else the board of
 * the rider's boarding station, which lists a later run today.
 */
async function mapLink(
    locale: Locale,
    number: string,
    stationId: string,
): Promise<{ href: string; live: boolean }> {
    const vehicleId = await liveVehicleId(number);
    const target: MapTarget | null = vehicleId
        ? { vehicleId }
        : stationId
          ? { station: stationId }
          : null;
    return target
        ? { href: mapPath(locale, target), live: !!vehicleId }
        : { href: trainPath(locale, number), live: false };
}

/** A run's delay card with a link to the train on the map; unknown runs are 404. */
export default async function Page({
    params,
    searchParams,
}: {
    params: Params;
    searchParams: Search;
}) {
    const { locale, run, card } = await load(params, searchParams);
    if (!run || !card) notFound();
    const t = await getTranslations({ locale, namespace: "DelayCard" });
    const tPages = await getTranslations({ locale, namespace: "Pages" });
    const sentence = delaySummarySentence(locale, card);
    const map = await mapLink(locale, run.number, card.from.stationId);
    return (
        <PageMain>
            <PageHeader current={t("title")} title={sentence} />
            {/* biome-ignore lint/performance/noImgElement: the share card itself, drawn by the og route */}
            <img
                src={imagePath(locale, run)}
                width={OG_SIZE.width}
                height={OG_SIZE.height}
                alt={t("image_alt", { sentence })}
                className="h-auto w-full rounded-lg border border-line bg-surface"
            />
            <p className="flex items-start gap-2 text-caption text-ink-2">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                {MEASUREMENT_NOTE[locale]}
            </p>
            <div className="flex flex-wrap gap-2">
                <Button variant="primary" asChild>
                    <Link href={map.href}>
                        <MapIcon className="size-5" aria-hidden />
                        {map.live
                            ? tPages("map_link")
                            : t("open_station", { station: card.from.name })}
                    </Link>
                </Button>
                <Button variant="secondary" asChild>
                    <Link href={trainPath(locale, run.number)}>
                        <ChartColumn className="size-5" aria-hidden />
                        {t("history")}
                    </Link>
                </Button>
            </div>
        </PageMain>
    );
}
