// Route handlers of the station and train pages, shared by their Hungarian
// and English paths (/hu/allomas/…, /en/station/…).

import type { Locale } from "@megisholavonat/core/i18n";
import { huTrainSubject } from "@megisholavonat/core/share";
import { stationType } from "@megisholavonat/core/stationType";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import { routing } from "@/i18n/routing";
import { siteUrl } from "@/lib/og/server";
import { fetchTrainPage, lookupStation } from "@/lib/seo/data";
import { seoMetadata, trainSubject } from "@/lib/seo/metadata";
import { type PageKind, stationPath, trainPath } from "@/lib/seo/paths";
import { trainName } from "@/lib/train";
import { decodeParam } from "@/lib/utils";
import { StationPage } from "./StationPage";
import { TrainPage } from "./TrainPage";

type Params = Promise<{ locale: string; slug: string }>;

const findStation = cache(lookupStation);
const findTrain = cache(fetchTrainPage);

/**
 * The page's locale; a path in the other language's words
 * ("/en/allomas/szolnok") goes to this language's own path.
 */
function pageLocale(
    raw: string,
    expected: Locale,
    kind: PageKind,
    key: string,
): Locale {
    if (!hasLocale(routing.locales, raw)) notFound();
    if (raw !== expected) {
        permanentRedirect(
            kind === "station" ? stationPath(raw, key) : trainPath(raw, key),
        );
    }
    return raw;
}

async function notFoundMetadata(locale: Locale, kind: PageKind) {
    const t = await getTranslations({ locale, namespace: "Pages" });
    const tHome = await getTranslations({ locale, namespace: "Home" });
    return {
        title: `${t(kind === "station" ? "station_not_found" : "train_not_found")} · ${tHome("app_title")}`,
        robots: { index: false },
    } satisfies Metadata;
}

export function stationRoute(expected: Locale) {
    async function generateMetadata({
        params,
    }: {
        params: Params;
    }): Promise<Metadata> {
        const { locale: raw, slug } = await params;
        if (!hasLocale(routing.locales, raw) || raw !== expected) return {};
        const locale = raw;
        const found = await findStation(decodeParam(slug));
        if (found.kind !== "found") return notFoundMetadata(locale, "station");
        const t = await getTranslations({ locale, namespace: "Pages" });
        const tHome = await getTranslations({ locale, namespace: "Home" });
        const name = found.station.name;
        return seoMetadata({
            locale,
            origin: siteUrl(),
            appTitle: tHome("app_title"),
            kind: "station",
            segment: found.segment,
            title: t("station_title", {
                station: name,
                type: stationType(found.station),
            }),
            description: t("station_description", { station: name }),
            image: `/${locale}/og/station/${encodeURIComponent(found.station.id)}`,
            imageAlt: name,
        });
    }

    async function Page({ params }: { params: Params }) {
        const { locale: raw, slug: rawSlug } = await params;
        const slug = decodeParam(rawSlug);
        const locale = pageLocale(raw, expected, "station", slug);
        const found = await findStation(slug);
        if (found.kind === "missing") notFound();
        if (found.kind === "redirect") {
            permanentRedirect(stationPath(locale, found.segment));
        }
        return (
            <StationPage
                locale={locale}
                stationId={found.station.id}
                segment={found.segment}
            />
        );
    }

    return { generateMetadata, Page };
}

export function trainRoute(expected: Locale) {
    async function generateMetadata({
        params,
    }: {
        params: Params;
    }): Promise<Metadata> {
        const { locale: raw, slug } = await params;
        if (!hasLocale(routing.locales, raw) || raw !== expected) return {};
        const locale = raw;
        const number = decodeParam(slug);
        const data = await findTrain(number);
        if (!data) return notFoundMetadata(locale, "train");
        const t = await getTranslations({ locale, namespace: "Pages" });
        const tHome = await getTranslations({ locale, namespace: "Home" });
        const full =
            data.history?.tripShortName ?? data.vehicle?.trip.tripShortName;
        const name = full ? trainName(full) : null;
        const subject = trainSubject(locale, number);
        const train = name ? `${subject} ${name}` : subject;
        // Today's run when it is on the map, else the usual route
        const stations = data.vehicle
            ? data.vehicle.trip.stoptimes.map((s) => s.stop.name)
            : (data.history?.stations ?? []).map(
                  (s) => s.stationName ?? s.stationId,
              );
        const route =
            stations.length > 1
                ? `${stations[0]} – ${stations[stations.length - 1]}`
                : "none";
        // "az 5-ös vonat ZEMPLÉN", "train 5 ZEMPLÉN"
        const article =
            locale === "hu"
                ? huTrainSubject(number).replace(/^A/, "a")
                : `train ${number}`;
        const lead = name ? `${article} ${name}` : article;
        return seoMetadata({
            locale,
            origin: siteUrl(),
            appTitle: tHome("app_title"),
            kind: "train",
            segment: number,
            title: t("train_title", { train }),
            description: t("train_description", { subject: lead, route }),
            image: data.vehicle
                ? `/${locale}/og/train/${encodeURIComponent(data.vehicle.vehicleId)}`
                : `/${locale}/og`,
            imageAlt: train,
        });
    }

    async function Page({ params }: { params: Params }) {
        const { locale: raw, slug } = await params;
        const number = decodeParam(slug);
        const locale = pageLocale(raw, expected, "train", number);
        const data = await findTrain(number);
        if (!data) notFound();
        return <TrainPage locale={locale} number={number} data={data} />;
    }

    return { generateMetadata, Page };
}
