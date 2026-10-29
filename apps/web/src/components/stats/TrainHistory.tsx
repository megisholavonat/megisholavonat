"use client";

import type { TrainRouteStation } from "@megisholavonat/api-client";
import { getTrainHistoryOptions } from "@megisholavonat/api-client/react-query";
import { formatSecondsAsTime } from "@megisholavonat/core/time";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { RouteGlyph } from "@/components/ui/RouteGlyph";
import { Link } from "@/i18n/navigation";
import { trainName } from "@/lib/train";
import {
    Card,
    EmptyState,
    LateChip,
    LoadError,
    lateLevel,
    MIN_SAMPLES,
    Of10Text,
    of10,
    RowsSkeleton,
    StatsHeader,
    TenBar,
    useDays,
    withDays,
} from "./StatsParts";

const HOUR = 60 * 60 * 1000;

/** A stop's share is told from as many runs as the trains list needs */
function enoughRuns(station: TrainRouteStation): boolean {
    return !station.insufficientData && station.n >= MIN_SAMPLES.trains;
}

function StationRow({
    station,
    days,
}: {
    station: TrainRouteStation;
    days: number;
}) {
    const t = useTranslations("Stats");
    const share = enoughRuns(station) ? (station.onTimeShare ?? null) : null;
    const late = share != null ? lateLevel(station.medianDelayMin) : null;
    return (
        <li className="flex min-h-11 items-center gap-3 border-b border-line py-1.5 text-[15px] last:border-b-0">
            <span className="tnum w-11 shrink-0 text-ink-2">
                {station.scheduledTimeS != null
                    ? formatSecondsAsTime(station.scheduledTimeS)
                    : ""}
            </span>
            <Link
                href={withDays(`/stats/station/${station.stationId}`, days)}
                className="min-w-0 flex-1 truncate hover:underline"
            >
                {station.stationName ?? station.stationId}
            </Link>
            {share != null ? (
                <>
                    {late && (
                        <LateChip level={late} className="max-sm:sr-only" />
                    )}
                    <TenBar share={share} late={late} />
                    <span className="tnum w-5 shrink-0 text-right font-semibold">
                        <span className="sr-only">
                            <Of10Text share={share} />
                        </span>
                        <span aria-hidden>{of10(share)}</span>
                    </span>
                </>
            ) : (
                <span className="text-sm text-ink-2">{t("few_data")}</span>
            )}
        </li>
    );
}

/** How punctual one train usually is, at its last stop and along the way. */
export function TrainHistoryPage({ number }: { number: string }) {
    const t = useTranslations("Stats");
    const days = useDays();
    const history = useQuery({
        ...getTrainHistoryOptions({
            path: { trainNumber: number },
            query: { days },
        }),
        staleTime: HOUR,
        retry: 1,
    });
    const data = history.data;
    const name = data?.tripShortName ? trainName(data.tripShortName) : null;
    const known = data?.stations.filter(
        (s) => enoughRuns(s) && s.onTimeShare != null,
    );
    const final = known?.[known.length - 1];
    const finalLate = final ? lateLevel(final.medianDelayMin) : null;

    return (
        <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-[max(env(safe-area-inset-bottom),24px)] lg:pt-8">
            <StatsHeader
                title={
                    <span className="flex min-w-0 items-center gap-2">
                        {data?.routeShortName && (
                            <RouteGlyph
                                routeShortName={data.routeShortName}
                                className="text-2xl"
                            />
                        )}
                        <span className="tnum">{number}</span>
                        {name && <span className="truncate">{name}</span>}
                    </span>
                }
                caption={
                    data
                        ? `${t("window", { days })} · ${t("runs", { runs: data.runs })}`
                        : t("window", { days })
                }
                fallbackHref={withDays("/stats", days)}
            />
            {history.isPending ? (
                <Card>
                    <RowsSkeleton rows={8} />
                </Card>
            ) : history.isError ? (
                <Card>
                    <LoadError onRetry={() => void history.refetch()} />
                </Card>
            ) : !data || !final || final.onTimeShare == null ? (
                <Card>
                    <EmptyState />
                </Card>
            ) : (
                <>
                    <Card>
                        <p className="text-[15px]">
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
                    </Card>
                    <Card title={t("by_stop")}>
                        <ol className="-mt-1 flex flex-col">
                            {data.stations.map((station) => (
                                <StationRow
                                    key={station.stationId}
                                    station={station}
                                    days={days}
                                />
                            ))}
                        </ol>
                    </Card>
                </>
            )}
        </main>
    );
}
