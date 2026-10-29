"use client";

import type { RankingEntry } from "@megisholavonat/api-client";
import {
    getRankingsOptions,
    getTimeOfDayPunctualityOptions,
} from "@megisholavonat/api-client/react-query";
import { getMavRouteName } from "@megisholavonat/core/mavRoutes";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { RouteGlyph } from "@/components/ui/RouteGlyph";
import { Link } from "@/i18n/navigation";
import { trainName } from "@/lib/train";
import { cn } from "@/lib/utils";
import { HourChart, overallShare } from "./HourChart";
import {
    Card,
    EmptyState,
    LateChip,
    LoadError,
    lateLevel,
    Of10Text,
    of10,
    RowsSkeleton,
    Segmented,
    StatsHeader,
    TenBar,
    useDays,
    withDays,
} from "./StatsParts";

const HOUR = 60 * 60 * 1000;
const KINDS = ["lines", "trains", "stations"] as const;
const ORDERS = ["best", "worst"] as const;
type RankingKind = (typeof KINDS)[number];
type RankingOrder = (typeof ORDERS)[number];
const LIMIT = 20;

function entryHref(kind: RankingKind, entry: RankingEntry): string | null {
    if (kind === "trains") return `/stats/train/${entry.id}`;
    if (kind === "stations") return `/stats/station/${entry.id}`;
    return null;
}

function RankingRow({
    kind,
    entry,
    days,
}: {
    kind: RankingKind;
    entry: RankingEntry;
    days: number;
}) {
    const late = lateLevel(entry.medianDelayMin);
    const label = kind === "trains" ? entry.id : (entry.name ?? entry.id);
    // "247 CITADELLA InterCity" -> "CITADELLA"
    const sub = kind === "trains" && entry.name ? trainName(entry.name) : null;
    const href = entryHref(kind, entry);
    // A line's glyph already reads its name; MÁV's data sometimes pairs a
    // line with another line's glyph, then only the name is shown
    const glyph =
        entry.routeShortName &&
        (kind !== "lines" ||
            getMavRouteName(entry.routeShortName) === entry.name)
            ? entry.routeShortName
            : null;
    const content = (
        <>
            <span className="tnum w-6 shrink-0 text-right text-sm text-ink-2">
                {entry.rank}
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
                {glyph && (
                    <RouteGlyph routeShortName={glyph} className="text-lg" />
                )}
                {(!glyph || kind !== "lines") && (
                    <span className="tnum shrink-0 font-semibold">{label}</span>
                )}
                {sub && <span className="truncate text-ink-2">{sub}</span>}
            </span>
            {late && <LateChip level={late} className="max-sm:sr-only" />}
            <TenBar share={entry.onTimeShare} late={late} />
            <span className="tnum w-5 shrink-0 text-right font-semibold">
                <span className="sr-only">
                    <Of10Text share={entry.onTimeShare} />
                </span>
                <span aria-hidden>{of10(entry.onTimeShare)}</span>
            </span>
            <span className="flex w-4 shrink-0 justify-end">
                {href && (
                    <ChevronRight className="size-4 text-ink-2" aria-hidden />
                )}
            </span>
        </>
    );
    const className =
        "flex min-h-12 w-full items-center gap-2.5 py-2 text-[15px] text-ink";
    return (
        <li className="border-b border-line last:border-b-0">
            {href ? (
                <Link
                    href={withDays(href, days)}
                    className={cn(className, "hover:bg-surface-2/60")}
                >
                    {content}
                </Link>
            ) : (
                <div className={className}>{content}</div>
            )}
        </li>
    );
}

function Rankings({ days }: { days: number }) {
    const t = useTranslations("Stats");
    const [kind, setKind] = useQueryState(
        "kind",
        parseAsStringLiteral(KINDS).withDefault("lines"),
    );
    const [order, setOrder] = useQueryState(
        "order",
        parseAsStringLiteral(ORDERS).withDefault("best"),
    );
    const rankings = useQuery({
        ...getRankingsOptions({
            query: { kind, order, days, limit: LIMIT },
        }),
        staleTime: HOUR,
    });
    const entries = rankings.data?.entries;
    return (
        <Card>
            <h2 className="sr-only">{t("rankings")}</h2>
            <Segmented<RankingKind>
                label={t("rankings")}
                value={kind}
                options={KINDS.map((k) => ({ value: k, label: t(k) }))}
                onChange={(k) => void setKind(k)}
            />
            <Segmented<RankingOrder>
                label={t("order")}
                value={order}
                options={ORDERS.map((o) => ({ value: o, label: t(o) }))}
                onChange={(o) => void setOrder(o)}
            />
            <div className="flex justify-end pr-6.5 text-caption text-ink-2">
                {t("column")}
            </div>
            {rankings.isPending ? (
                <RowsSkeleton rows={8} />
            ) : rankings.isError ? (
                <LoadError onRetry={() => void rankings.refetch()} />
            ) : entries && entries.length > 0 ? (
                <ol className="-mt-2 flex flex-col">
                    {entries.map((entry) => (
                        <RankingRow
                            key={entry.id}
                            kind={kind}
                            entry={entry}
                            days={days}
                        />
                    ))}
                </ol>
            ) : (
                <EmptyState />
            )}
        </Card>
    );
}

function NetworkByHour({ days }: { days: number }) {
    const t = useTranslations("Stats");
    const query = useQuery({
        ...getTimeOfDayPunctualityOptions({ query: { days } }),
        staleTime: HOUR,
    });
    const overall = query.data ? overallShare(query.data.hours) : null;
    return (
        <Card title={t("all_trains")} className="lg:col-start-2 lg:row-start-1">
            {query.isPending ? (
                <div className="h-48 animate-pulse rounded-md bg-surface-2" />
            ) : query.isError ? (
                <LoadError onRetry={() => void query.refetch()} />
            ) : overall ? (
                <>
                    <div className="flex items-center gap-3 text-[15px]">
                        <TenBar share={overall.share} size="lg" />
                        <Of10Text share={overall.share} />
                    </div>
                    <h3 className="mt-2 text-sm font-semibold text-ink-2">
                        {t("by_hour")}
                    </h3>
                    <HourChart hours={query.data.hours} />
                </>
            ) : (
                <EmptyState />
            )}
        </Card>
    );
}

/** Rankings of lines, trains and stations, and the network by hour. */
export function StatsPage() {
    const t = useTranslations("Stats");
    const days = useDays();
    return (
        <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-4 px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-[max(env(safe-area-inset-bottom),24px)] lg:pt-8">
            <StatsHeader
                title={t("title")}
                caption={t("window", { days })}
                fallbackHref="/"
            />
            <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-flow-dense lg:grid-cols-[minmax(0,1fr)_400px]">
                <NetworkByHour days={days} />
                <Rankings days={days} />
            </div>
        </main>
    );
}
