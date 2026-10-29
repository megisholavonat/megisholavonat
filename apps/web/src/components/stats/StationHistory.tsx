"use client";

import {
    getStationBoardOptions,
    getStationPlatformsOptions,
    getTimeOfDayPunctualityOptions,
} from "@megisholavonat/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Map as MapIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { HourChart, overallShare } from "./HourChart";
import {
    Card,
    EmptyState,
    LoadError,
    Of10Text,
    StatsHeader,
    TenBar,
    useDays,
    withDays,
} from "./StatsParts";

const HOUR = 60 * 60 * 1000;
/** Below this many passages the station's share is not shown */
const MIN_STATION_SAMPLES = 50;

/** The station's name: from its platform history, else from its board. */
function useStationName(stationId: string, days: number): string | null {
    const platforms = useQuery({
        ...getStationPlatformsOptions({
            path: { stationId },
            query: { days },
        }),
        staleTime: HOUR,
        retry: false,
    });
    const named = platforms.data?.stationName;
    const board = useQuery({
        ...getStationBoardOptions({
            path: { stationId },
            query: { limit: 1 },
        }),
        enabled: platforms.isFetched && !named,
        staleTime: HOUR,
        retry: false,
    });
    return named ?? board.data?.station.name ?? null;
}

/** How punctual trains are at a station, overall and by hour. */
export function StationHistoryPage({ stationId }: { stationId: string }) {
    const t = useTranslations("Stats");
    const days = useDays();
    const name = useStationName(stationId, days);
    const query = useQuery({
        ...getTimeOfDayPunctualityOptions({ query: { stationId, days } }),
        staleTime: HOUR,
        retry: 1,
    });
    const overall = query.data ? overallShare(query.data.hours) : null;

    return (
        <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-[max(env(safe-area-inset-bottom),24px)] lg:pt-8">
            <StatsHeader
                title={
                    name ?? (
                        <span className="inline-block h-7 w-48 animate-pulse rounded-sm bg-surface-2 align-middle" />
                    )
                }
                caption={t("window", { days })}
                fallbackHref={withDays("/stats", days)}
                trailing={
                    <Link
                        href={`/?station=${stationId}`}
                        aria-label={t("show_on_map")}
                        title={t("show_on_map")}
                        className="pressable flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink hover:bg-surface-2"
                    >
                        <MapIcon className="size-5" aria-hidden />
                    </Link>
                }
            />
            {query.isPending ? (
                <Card>
                    <div className="h-56 animate-pulse rounded-md bg-surface-2" />
                </Card>
            ) : query.isError ? (
                <Card>
                    <LoadError onRetry={() => void query.refetch()} />
                </Card>
            ) : overall && overall.n >= MIN_STATION_SAMPLES ? (
                <Card>
                    <div className="flex items-center gap-3 text-[15px]">
                        <TenBar share={overall.share} size="lg" />
                        <Of10Text share={overall.share} />
                    </div>
                    <h2 className="mt-2 text-sm font-semibold text-ink-2">
                        {t("by_hour")}
                    </h2>
                    <HourChart hours={query.data.hours} />
                </Card>
            ) : (
                <Card>
                    <EmptyState />
                </Card>
            )}
        </main>
    );
}
