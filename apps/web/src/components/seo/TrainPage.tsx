// The crawlable page of a train number: its route, how late it usually is,
// today's run when it is on the map, and its stops.

import type { TrainRouteStation } from "@megisholavonat/api-client";
import type { Locale } from "@megisholavonat/core/i18n";
import { mapPath, stationHref, trainPath } from "@megisholavonat/core/links";
import { trainShareText } from "@megisholavonat/core/share";
import { formatSecondsAsTime } from "@megisholavonat/core/time";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
    DEFAULT_DAYS,
    lateLevel,
    MIN_SAMPLES,
    of10,
} from "@/components/stats/figures";
import { LateChip, Of10Text, TenBar } from "@/components/stats/StatsParts";
import { DelayChip } from "@/components/ui/Delay";
import { PlatformBadge } from "@/components/ui/Platform";
import { trainCard, trainShareInfo } from "@/lib/og/model";
import { siteUrl } from "@/lib/og/server";
import type { TrainPageData } from "@/lib/seo/data";
import { breadcrumbs, trainSubject } from "@/lib/seo/metadata";
import { stationIdOf, trainName } from "@/lib/train";
import { PageHeader } from "./PageHeader";
import { PageMain } from "./PageMain";
import { Glyph, JsonLd, MapLink, Section } from "./PageParts";
import { TrackPageView } from "./TrackPageView";

/** A stop's share is told from as many runs as the rankings need */
function enoughRuns(station: TrainRouteStation): boolean {
    return !station.insufficientData && station.n >= MIN_SAMPLES.trains;
}

interface Stop {
    id: string | null;
    name: string;
    time: string;
    platform: string | null;
    share: number | null;
    median: number | null | undefined;
}

/**
 * Stops of today's run when it is on the map, with each stop's usual
 * punctuality; else of the usual route.
 */
function stopsOf(data: TrainPageData): { stops: Stop[]; today: boolean } {
    const route = data.history?.stations ?? [];
    if (route.length > 0 && !data.vehicle) {
        return {
            today: false,
            stops: route.map((s) => ({
                id: s.stationId,
                name: s.stationName ?? s.stationId,
                time:
                    s.scheduledTimeS != null
                        ? formatSecondsAsTime(s.scheduledTimeS)
                        : "",
                platform: s.insufficientData
                    ? null
                    : (s.typicalPlatform ?? null),
                share: enoughRuns(s) ? (s.onTimeShare ?? null) : null,
                median: s.medianDelayMin,
            })),
        };
    }
    const stoptimes = data.vehicle?.trip.stoptimes ?? [];
    const usual = new Map(route.map((s) => [s.stationId, s]));
    return {
        today: true,
        stops: stoptimes.map((s, i) => {
            const id = stationIdOf(s.stop);
            const history = id ? usual.get(id) : undefined;
            return {
                id,
                name: s.stop.name,
                time: formatSecondsAsTime(
                    i === stoptimes.length - 1
                        ? s.scheduledArrival
                        : s.scheduledDeparture,
                ),
                platform: s.stop.platformCode ?? null,
                share:
                    history && enoughRuns(history)
                        ? (history.onTimeShare ?? null)
                        : null,
                median: history?.medianDelayMin,
            };
        }),
    };
}

export async function TrainPage({
    locale,
    number,
    data,
}: {
    locale: Locale;
    number: string;
    data: TrainPageData;
}) {
    const t = await getTranslations({ locale, namespace: "Pages" });
    const tStats = await getTranslations({ locale, namespace: "Stats" });
    const tHome = await getTranslations({ locale, namespace: "Home" });
    const { history, vehicle } = data;
    const fullName =
        history?.tripShortName ?? vehicle?.trip.tripShortName ?? number;
    const name = trainName(fullName);
    const routeShortName =
        history?.routeShortName ?? vehicle?.trip.route.shortName ?? null;
    const { stops, today } = stopsOf(data);
    const first = stops[0];
    const last = stops[stops.length - 1];
    const card = vehicle ? trainCard(vehicle) : null;
    const known = history?.stations.filter(
        (s) => enoughRuns(s) && s.onTimeShare != null,
    );
    const final = known?.[known.length - 1];
    const finalLate = final ? lateLevel(final.medianDelayMin) : null;
    const origin = siteUrl();
    const url = `${origin}${trainPath(locale, number)}`;
    const title = name ? `${number} ${name}` : trainSubject(locale, number);
    const mapHref = mapPath(
        locale,
        vehicle
            ? { vehicleId: vehicle.vehicleId }
            : first?.id
              ? { station: first.id }
              : null,
    );

    return (
        <PageMain>
            <TrackPageView
                kind="train"
                train_number={number}
                days={history?.window.days ?? DEFAULT_DAYS}
            />
            <JsonLd
                data={[
                    {
                        "@context": "https://schema.org",
                        "@type": "TrainTrip",
                        name: title,
                        trainNumber: number,
                        ...(name ? { trainName: name } : {}),
                        url,
                        ...(first && last && first !== last
                            ? {
                                  departureStation: {
                                      "@type": "TrainStation",
                                      name: first.name,
                                  },
                                  arrivalStation: {
                                      "@type": "TrainStation",
                                      name: last.name,
                                  },
                              }
                            : {}),
                    },
                    breadcrumbs([
                        {
                            name: tHome("app_title"),
                            url: `${origin}${mapPath(locale)}`,
                        },
                        { name: title, url },
                    ]),
                ]}
            />
            <PageHeader
                current={t("train")}
                titleClassName="flex min-w-0 items-center gap-2"
                title={
                    <>
                        <Glyph
                            routeShortName={routeShortName}
                            className="text-2xl"
                        />
                        <span className="tnum">{number}</span>
                        {name && <span className="truncate">{name}</span>}
                    </>
                }
                caption={
                    first && last && first !== last
                        ? `${first.name} – ${last.name}`
                        : undefined
                }
            />
            <MapLink href={mapHref} label={t("map_link")} />
            <Section title={t("now")}>
                {card ? (
                    <p className="flex items-center gap-2 text-subhead">
                        {card.status === "running" && (
                            <DelayChip delay={card.delay} />
                        )}
                        <span>
                            {trainShareText(locale, trainShareInfo(card))}
                        </span>
                    </p>
                ) : (
                    <p className="text-subhead text-ink-2">
                        {t("not_running")}
                    </p>
                )}
            </Section>
            <Section
                title={t("punctuality")}
                caption={
                    history
                        ? `${tStats("window", { days: history.window.days })} · ${tStats("runs", { runs: history.runs })}`
                        : undefined
                }
            >
                {final?.onTimeShare != null ? (
                    <>
                        <p className="text-subhead">
                            <Of10Text
                                share={final.onTimeShare}
                                station={final.stationName}
                            />
                        </p>
                        <div className="flex items-center gap-3">
                            <TenBar
                                share={final.onTimeShare}
                                late={finalLate}
                                size="lg"
                            />
                            {finalLate && <LateChip level={finalLate} />}
                        </div>
                    </>
                ) : (
                    <p className="text-ink-2">{t("few_data")}</p>
                )}
            </Section>
            {stops.length > 0 && (
                <Section
                    title={t("stops")}
                    caption={today ? t("stops_today") : t("usual_route")}
                >
                    <ol className="-mt-1 flex flex-col">
                        {stops.map((stop, i) => {
                            const late =
                                stop.share != null
                                    ? lateLevel(stop.median)
                                    : null;
                            return (
                                <li
                                    // biome-ignore lint/suspicious/noArrayIndexKey: a route may pass a station twice
                                    key={`${stop.id ?? stop.name}-${i}`}
                                    className="flex min-h-11 items-center gap-3 border-b border-line py-1.5 text-subhead last:border-b-0"
                                >
                                    <span className="tnum w-11 shrink-0 text-ink-2">
                                        {stop.time}
                                    </span>
                                    {stop.id ? (
                                        <Link
                                            href={stationHref(locale, {
                                                id: stop.id,
                                                name: stop.name,
                                            })}
                                            className="min-w-0 flex-1 truncate hover:underline"
                                        >
                                            {stop.name}
                                        </Link>
                                    ) : (
                                        <span className="min-w-0 flex-1 truncate">
                                            {stop.name}
                                        </span>
                                    )}
                                    {stop.share != null && (
                                        <>
                                            {late && (
                                                <LateChip
                                                    level={late}
                                                    className="max-sm:sr-only"
                                                />
                                            )}
                                            <TenBar
                                                share={stop.share}
                                                late={late}
                                            />
                                            <span className="tnum w-5 shrink-0 text-right font-semibold">
                                                <span className="sr-only">
                                                    <Of10Text
                                                        share={stop.share}
                                                    />
                                                </span>
                                                <span aria-hidden>
                                                    {of10(stop.share)}
                                                </span>
                                            </span>
                                        </>
                                    )}
                                    <span className="flex w-10 shrink-0 justify-end">
                                        {stop.platform && (
                                            <PlatformBadge
                                                platform={stop.platform}
                                                predicted={!today}
                                            />
                                        )}
                                    </span>
                                </li>
                            );
                        })}
                    </ol>
                </Section>
            )}
        </PageMain>
    );
}
