// The crawlable page of a station: its next departures and arrivals with
// live delays, disruptions and how punctual trains are there.

import type { BoardEntry, StationBoard } from "@megisholavonat/api-client";
import type { Locale } from "@megisholavonat/core/i18n";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
    DEFAULT_DAYS,
    MIN_SAMPLES,
    overallShare,
} from "@/components/stats/figures";
import { HourChart } from "@/components/stats/HourChart";
import { Of10Text, TenBar } from "@/components/stats/StatsParts";
import { DelayChip } from "@/components/ui/Delay";
import { PlatformBadge } from "@/components/ui/Platform";
import { type RowDelay, rowTime } from "@/lib/board";
import { departureDelay, formatClock } from "@/lib/og/model";
import { siteUrl } from "@/lib/og/server";
import { fetchStationBoard, fetchTimeOfDay } from "@/lib/seo/data";
import { breadcrumbs } from "@/lib/seo/metadata";
import { stationPath, trainPath } from "@/lib/seo/paths";
import { trainName, trainNumber } from "@/lib/train";
import {
    Breadcrumb,
    Glyph,
    JsonLd,
    MapLink,
    PageMain,
    Section,
} from "./PageParts";
import { TrackPageView } from "./TrackPageView";

type Kind = "departures" | "arrivals";

/**
 * A board's rows with their delays, in the order of the times they show,
 * by the map board's rules (lib/board).
 */
function boardRows(entries: BoardEntry[], now: Date) {
    return entries
        .map((entry) => {
            const delay = departureDelay(entry, now);
            const shown: RowDelay | null =
                delay === null ? null : { delay, stale: false };
            return { entry, shown, ...rowTime(entry, shown) };
        })
        .sort(
            (a, b) =>
                a.time - b.time ||
                a.entry.scheduledTime - b.entry.scheduledTime,
        );
}

async function BoardRow({
    entry,
    kind,
    locale,
    shown,
    time,
    late,
}: {
    entry: BoardEntry;
    kind: Kind;
    locale: Locale;
    shown: RowDelay | null;
    /** The time shown: the expected one when late, as on the map's board */
    time: number;
    late: boolean;
}) {
    const t = await getTranslations({ locale, namespace: "Station" });
    const tDisruptions = await getTranslations({
        locale,
        namespace: "Disruptions",
    });
    const number = trainNumber(entry.tripShortName);
    const name = trainName(entry.tripShortName);
    const place = entry.headsign
        ? kind === "arrivals"
            ? t("from", { station: entry.headsign })
            : entry.headsign
        : "";
    return (
        <li className="flex min-h-14 items-center gap-3 border-b border-line py-2 last:border-b-0">
            <span className="flex w-[4.25rem] shrink-0 flex-col items-start gap-0.5">
                <span
                    className={
                        entry.canceled
                            ? "tnum text-headline font-bold text-ink-2 line-through"
                            : "tnum text-headline font-bold"
                    }
                >
                    {formatClock(time)}
                </span>
                <span className="flex items-center gap-1">
                    {entry.canceled ? (
                        <span className="inline-flex h-5 items-center rounded-full bg-delay-severe-tint px-1.5 text-caption font-bold text-delay-severe">
                            {t("canceled")}
                        </span>
                    ) : shown ? (
                        <DelayChip delay={shown.delay} />
                    ) : null}
                    {late && (
                        <s className="tnum text-caption text-ink-2">
                            <span className="sr-only">
                                {t("scheduled_time")}{" "}
                            </span>
                            {formatClock(entry.scheduledTime)}
                        </s>
                    )}
                </span>
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[15px] font-semibold">
                    {place}
                </span>
                <span className="flex min-w-0 items-center gap-1 text-sm text-ink-2">
                    <Glyph routeShortName={entry.routeShortName} />
                    <Link
                        href={trainPath(locale, number)}
                        className="tnum min-w-0 truncate text-ink hover:underline"
                    >
                        {name ? `${number} ${name}` : number}
                    </Link>
                    {entry.disruption && (
                        <>
                            <span aria-hidden>·</span>
                            <span className="truncate font-semibold text-delay-severe">
                                {tDisruptions(`effect_${entry.disruption}`)}
                            </span>
                        </>
                    )}
                </span>
            </span>
            <span className="flex w-10 justify-end">
                {entry.platform && <PlatformBadge platform={entry.platform} />}
            </span>
        </li>
    );
}

async function Board({
    board,
    kind,
    locale,
    now,
}: {
    board: StationBoard | null;
    kind: Kind;
    locale: Locale;
    now: Date;
}) {
    const t = await getTranslations({ locale, namespace: "Pages" });
    const tStation = await getTranslations({ locale, namespace: "Station" });
    const entries = board?.entries ?? [];
    return (
        <Section title={t(kind)}>
            {entries.length === 0 ? (
                <p className="py-4 text-ink-2">{tStation("empty")}</p>
            ) : (
                <ul className="-mt-1 flex flex-col">
                    {boardRows(entries, now).map((row) => (
                        <BoardRow
                            key={`${row.entry.tripId}-${row.entry.serviceDate}`}
                            entry={row.entry}
                            kind={kind}
                            locale={locale}
                            shown={row.shown}
                            time={row.time}
                            late={row.late}
                        />
                    ))}
                </ul>
            )}
        </Section>
    );
}

/** Trains of the boards that do not run, or run only in part. */
function disrupted(boards: (StationBoard | null)[]): BoardEntry[] {
    const seen = new Set<string>();
    const out: BoardEntry[] = [];
    for (const entry of boards.flatMap((b) => b?.entries ?? [])) {
        if (!entry.canceled && !entry.disruption) continue;
        const key = `${entry.tripId}-${entry.serviceDate}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(entry);
    }
    return out;
}

export async function StationPage({
    locale,
    stationId,
    segment,
}: {
    locale: Locale;
    stationId: string;
    segment: string;
}) {
    const t = await getTranslations({ locale, namespace: "Pages" });
    const tStats = await getTranslations({ locale, namespace: "Stats" });
    const tHome = await getTranslations({ locale, namespace: "Home" });
    const tStation = await getTranslations({ locale, namespace: "Station" });
    const tDisruptions = await getTranslations({
        locale,
        namespace: "Disruptions",
    });
    const [departures, arrivals, hours] = await Promise.all([
        fetchStationBoard(stationId, "departures"),
        fetchStationBoard(stationId, "arrivals"),
        fetchTimeOfDay(stationId),
    ]);
    const station = (departures ?? arrivals)?.station;
    if (!station) return null;
    const now = new Date();
    const origin = siteUrl();
    const url = `${origin}${stationPath(locale, segment)}`;
    const overall = hours ? overallShare(hours.hours) : null;
    const problems = disrupted([departures, arrivals]);

    return (
        <PageMain>
            <TrackPageView
                kind="station"
                station_id={station.id}
                days={hours?.window.days ?? DEFAULT_DAYS}
            />
            <JsonLd
                data={[
                    {
                        "@context": "https://schema.org",
                        "@type": "TrainStation",
                        name: station.name,
                        url,
                        geo: {
                            "@type": "GeoCoordinates",
                            latitude: station.lat,
                            longitude: station.lon,
                        },
                    },
                    breadcrumbs([
                        {
                            name: tHome("app_title"),
                            url: `${origin}/${locale}`,
                        },
                        { name: station.name, url },
                    ]),
                ]}
            />
            <Breadcrumb
                home={tHome("app_title")}
                homeHref={`/${locale}`}
                current={t("station")}
            />
            <h1 className="text-title font-bold">{station.name}</h1>
            <MapLink
                href={`/${locale}?station=${encodeURIComponent(station.id)}`}
                label={t("map_link")}
            />
            {problems.length > 0 && (
                <Section title={t("disruptions")}>
                    <ul className="flex flex-col gap-1 text-[15px]">
                        {problems.map((entry) => {
                            const number = trainNumber(entry.tripShortName);
                            return (
                                <li
                                    key={`${entry.tripId}-${entry.serviceDate}`}
                                    className="flex min-h-9 items-center gap-2"
                                >
                                    <span className="tnum w-12 shrink-0 text-ink-2">
                                        {formatClock(entry.scheduledTime)}
                                    </span>
                                    <Link
                                        href={trainPath(locale, number)}
                                        className="tnum shrink-0 font-semibold hover:underline"
                                    >
                                        {number}
                                    </Link>
                                    <span className="min-w-0 flex-1 truncate">
                                        {entry.headsign}
                                    </span>
                                    <span className="shrink-0 font-semibold text-delay-severe">
                                        {entry.disruption
                                            ? tDisruptions(
                                                  `effect_${entry.disruption}`,
                                              )
                                            : tStation("canceled")}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </Section>
            )}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Board
                    board={departures}
                    kind="departures"
                    locale={locale}
                    now={now}
                />
                <Board
                    board={arrivals}
                    kind="arrivals"
                    locale={locale}
                    now={now}
                />
            </div>
            <Section
                title={t("punctuality")}
                caption={tStats("window", { days: hours?.window.days ?? 28 })}
            >
                {hours && overall && overall.n >= MIN_SAMPLES.stations ? (
                    <>
                        <div className="flex items-center gap-3 text-[15px]">
                            <TenBar share={overall.share} size="lg" />
                            <Of10Text share={overall.share} />
                        </div>
                        <h3 className="mt-2 text-sm font-semibold text-ink-2">
                            {tStats("by_hour")}
                        </h3>
                        <HourChart hours={hours.hours} />
                    </>
                ) : (
                    <p className="text-ink-2">{t("few_data")}</p>
                )}
            </Section>
        </PageMain>
    );
}
