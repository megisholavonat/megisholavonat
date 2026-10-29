"use client";

import type {
    BoardEntry,
    Station,
    TrainFeatureProperties,
} from "@megisholavonat/api-client";
import {
    getStationBoardOptions,
    getStationPlatformsOptions,
    getTrainsOptions,
} from "@megisholavonat/api-client/react-query";
import { getDelayLevel } from "@megisholavonat/core/delay";
import type { DelayReasonCode } from "@megisholavonat/core/delayReasons";
import { trainDisplay } from "@megisholavonat/core/display";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { StationDisruptions } from "@/components/disruptions/Disruptions";
import { SheetClose } from "@/components/sheet/BottomSheet";
import { StationHistoryLink } from "@/components/stats/HistoryLinks";
import { BackButton } from "@/components/train/TrainParts";
import { DelayChip } from "@/components/ui/Delay";
import { PlatformBadge } from "@/components/ui/Platform";
import { ReasonLabel } from "@/components/ui/Reason";
import { RouteGlyph } from "@/components/ui/RouteGlyph";
import { useNow } from "@/hooks/useNow";
import { usePredictedPlatforms } from "@/hooks/usePredictedPlatforms";
import { boardRowOpened } from "@/lib/analyticsEvents";
import { rowTime } from "@/lib/board";
import { trainNumber, usuallyLate } from "@/lib/train";
import { cn } from "@/lib/utils";

export type BoardKind = "departures" | "arrivals";

const timeFormat = new Intl.DateTimeFormat("hu-HU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Budapest",
});

function formatTime(epochSeconds: number): string {
    return timeFormat.format(new Date(epochSeconds * 1000));
}

function useBoard(stationId: string, kind: BoardKind) {
    const board = useQuery({
        ...getStationBoardOptions({
            path: { stationId },
            query: { kind, limit: 30 },
        }),
        refetchInterval: 30_000,
    });
    const predicted = usePredictedPlatforms(stationId);
    return { board, predicted };
}

/** The map's trains by vehicle id, from the feed the map already polls. */
function useLiveTrains(): Map<string, TrainFeatureProperties> {
    const feed = useQuery({ ...getTrainsOptions(), staleTime: Infinity });
    return useMemo(
        () =>
            new Map(
                (feed.data?.features ?? []).map((f) => [
                    f.properties.vehicleId,
                    f.properties,
                ]),
            ),
        [feed.data],
    );
}

/**
 * Train number -> "usually late" here, from the same request as the
 * predicted platforms (no request per row).
 */
function useUsuallyLate(stationId: string): Map<string, "late" | "veryLate"> {
    const platforms = useQuery({
        ...getStationPlatformsOptions({ path: { stationId } }),
        staleTime: 60 * 60 * 1000,
        retry: false,
    });
    return useMemo(() => {
        const map = new Map<string, "late" | "veryLate">();
        for (const typical of platforms.data?.typicalDelays ?? []) {
            const level = usuallyLate(typical);
            if (level) map.set(typical.trainNumber, level);
        }
        return map;
    }, [platforms.data]);
}

/**
 * What a row shows for its delay. A train on the map shows what its marker
 * shows (grey "+7?" for old data, nothing while it waits to depart); one
 * that is not on the map shows the board's realtime delay, if any, and only
 * a late one before it is due to leave.
 */
function rowDelay(
    entry: BoardEntry,
    kind: BoardKind,
    train: TrainFeatureProperties | undefined,
    now: Date,
): { delay: number; stale: boolean } | null {
    if (entry.canceled) return null;
    if (train) {
        const display = trainDisplay(train, now);
        if (display.state === "running" || display.state === "stale") {
            return {
                delay: display.delay ?? 0,
                stale: display.state === "stale",
            };
        }
        return null;
    }
    const live = entry.realtime || entry.delaySource === "gps";
    if (!live) return null;
    // A departure still ahead with no delay may well be waiting to leave
    // ("pontos" would claim it is running): plain time unless it is late
    const ahead =
        kind === "departures" && entry.scheduledTime * 1000 > now.getTime();
    if (ahead && entry.delayMinutes <= 0) return null;
    return { delay: entry.delayMinutes, stale: false };
}

export function KindSwitch({
    kind,
    onChange,
}: {
    kind: BoardKind;
    onChange: (kind: BoardKind) => void;
}) {
    const t = useTranslations("Station");
    return (
        <div
            role="tablist"
            aria-label={t("board")}
            className="grid grid-cols-2 rounded-md bg-surface-2 p-0.5"
        >
            {(["departures", "arrivals"] as const).map((k) => (
                <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={kind === k}
                    onClick={() => onChange(k)}
                    className={cn(
                        "relative h-9 cursor-pointer rounded-[8px] px-4 text-sm transition-colors before:absolute before:inset-x-0 before:-inset-y-1",
                        kind === k
                            ? "bg-surface font-semibold text-ink shadow-sm"
                            : "text-ink-2",
                    )}
                >
                    {t(k)}
                </button>
            ))}
        </div>
    );
}

function BoardRow({
    entry,
    kind,
    predictedPlatform,
    shown,
    usually,
    now,
    onSelectTrain,
    wide,
}: {
    entry: BoardEntry;
    kind: BoardKind;
    predictedPlatform: string | null;
    /** The row's delay, from the map's train when it is there */
    shown: { delay: number; stale: boolean } | null;
    usually: "late" | "veryLate" | undefined;
    now: Date;
    onSelectTrain: (vehicleId: string) => void;
    wide: boolean;
}) {
    const t = useTranslations("Station");
    const tDisruptions = useTranslations("Disruptions");
    const number = trainNumber(entry.tripShortName);
    const place = entry.headsign
        ? kind === "arrivals"
            ? t("from", { station: entry.headsign })
            : entry.headsign
        : "";
    const platform = entry.platform ?? predictedPlatform;
    const { time, late } = rowTime(entry, shown);
    const level = shown && !shown.stale ? getDelayLevel(shown.delay) : null;
    // The cause only next to a live delay that is actually late
    const reason =
        level && level !== "onTime" && entry.reason?.code
            ? (entry.reason.code as DelayReasonCode)
            : null;
    // "Usually late" in plain words, only before the train departs
    const usuallyText =
        !shown &&
        !entry.canceled &&
        usually &&
        entry.scheduledTime * 1000 > now.getTime()
            ? t(usually === "veryLate" ? "usually_very_late" : "usually_late")
            : null;
    const chip = entry.canceled ? (
        <span className="inline-flex h-5 items-center rounded-full bg-delay-severe-tint px-1.5 text-caption font-bold text-delay-severe">
            {t("canceled")}
        </span>
    ) : shown ? (
        <DelayChip delay={shown.delay} stale={shown.stale} />
    ) : null;
    const note = entry.disruption ? (
        <span className="truncate font-semibold text-delay-severe">
            {tDisruptions(`effect_${entry.disruption}`)}
        </span>
    ) : reason && level ? (
        <ReasonLabel code={reason} level={level} />
    ) : usuallyText ? (
        <span className="truncate text-delay-slight">{usuallyText}</span>
    ) : null;
    const content = (
        <>
            <div
                className={cn(
                    "flex shrink-0 flex-col items-start gap-0.5",
                    wide ? "w-44 flex-row items-center gap-2" : "w-[4.25rem]",
                )}
            >
                <span
                    className={cn(
                        "tnum text-headline font-bold",
                        entry.canceled && "text-ink-2 line-through",
                    )}
                >
                    {formatTime(time)}
                </span>
                <span className="flex items-center gap-1">
                    {chip}
                    {late && (
                        <s className="tnum text-caption text-ink-2">
                            <span className="sr-only">
                                {t("scheduled_time")}{" "}
                            </span>
                            {formatTime(entry.scheduledTime)}
                        </s>
                    )}
                </span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                    className={cn(
                        "truncate text-headline",
                        entry.canceled && "text-ink-2",
                    )}
                >
                    {place}
                </span>
                {wide && note && (
                    <span className="flex min-w-0 text-sm">{note}</span>
                )}
                {!wide && (
                    <span className="flex min-w-0 items-center gap-1 text-sm text-ink-2">
                        <RouteGlyph routeShortName={entry.routeShortName} />
                        <span className="tnum shrink-0">{number}</span>
                        {note && (
                            <>
                                <span aria-hidden>·</span>
                                {note}
                            </>
                        )}
                    </span>
                )}
            </div>
            {wide && (
                <span className="flex w-24 items-center gap-1 text-[15px] text-ink">
                    <RouteGlyph routeShortName={entry.routeShortName} />
                    <span className="tnum">{number}</span>
                </span>
            )}
            <span className="flex w-10 justify-end">
                {platform && (
                    <PlatformBadge
                        platform={platform}
                        predicted={!entry.platform}
                    />
                )}
            </span>
        </>
    );
    const className = "flex w-full items-center gap-3 py-3 text-left";
    return (
        <li className="border-b border-line last:border-b-0">
            {entry.vehicleId ? (
                <button
                    type="button"
                    data-focus-key={`train:${entry.vehicleId}`}
                    className={cn(
                        className,
                        "cursor-pointer hover:bg-surface-2/60",
                    )}
                    onClick={() =>
                        entry.vehicleId && onSelectTrain(entry.vehicleId)
                    }
                >
                    {content}
                </button>
            ) : (
                <div className={className}>{content}</div>
            )}
        </li>
    );
}

function BoardList({
    station,
    kind,
    onSelectTrain,
    wide,
}: {
    station: Station;
    kind: BoardKind;
    onSelectTrain: (vehicleId: string) => void;
    wide: boolean;
}) {
    const t = useTranslations("Station");
    const tStates = useTranslations("States");
    const { board, predicted } = useBoard(station.id, kind);
    const live = useLiveTrains();
    const usually = useUsuallyLate(station.id);
    const now = new Date(useNow());
    if (board.isPending) {
        return (
            <div className="flex flex-col gap-5 py-3" aria-hidden>
                {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                        <span className="h-5 w-12 rounded-sm bg-surface-2" />
                        <span className="h-5 flex-1 rounded-sm bg-surface-2" />
                        <span className="size-7 rounded-sm bg-surface-2" />
                    </div>
                ))}
            </div>
        );
    }
    if (board.isError) {
        return (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
                <p className="text-ink-2">{tStates("load_error")}</p>
                <button
                    type="button"
                    className="flex h-10 cursor-pointer items-center gap-2 rounded-full bg-surface-2 px-4 text-sm font-semibold"
                    onClick={() => board.refetch()}
                >
                    <RefreshCw className="size-4" aria-hidden />
                    {tStates("retry")}
                </button>
            </div>
        );
    }
    // Sorted by the time each row shows: the API's expected time, but with
    // the delay the map shows
    const rows = board.data.entries
        .map((entry) => {
            const shown = rowDelay(
                entry,
                kind,
                entry.vehicleId ? live.get(entry.vehicleId) : undefined,
                now,
            );
            return { entry, shown, time: rowTime(entry, shown).time };
        })
        .sort(
            (a, b) =>
                a.time - b.time ||
                a.entry.scheduledTime - b.entry.scheduledTime,
        );
    if (rows.length === 0) {
        return <p className="py-8 text-center text-ink-2">{t("empty")}</p>;
    }
    return (
        <ul className="flex flex-col">
            {rows.map(({ entry, shown }, i) => (
                <BoardRow
                    key={`${entry.tripId}-${entry.serviceDate}`}
                    entry={entry}
                    kind={kind}
                    predictedPlatform={
                        predicted.get(trainNumber(entry.tripShortName)) ?? null
                    }
                    shown={shown}
                    usually={usually.get(trainNumber(entry.tripShortName))}
                    now={now}
                    onSelectTrain={(id) => {
                        boardRowOpened(kind, i);
                        onSelectTrain(id);
                    }}
                    wide={wide}
                />
            ))}
        </ul>
    );
}

/** Mobile station sheet header (half · full): name, history, board switch. */
export function StationSheetHeader({
    station,
    kind,
    onKindChange,
    onClose,
}: {
    station: Station;
    kind: BoardKind;
    onKindChange: (kind: BoardKind) => void;
    onClose: () => void;
}) {
    return (
        <>
            <SheetClose onClick={onClose} />
            <div className="flex flex-col gap-3 px-4 pb-2">
                <div className="flex min-h-9 items-center gap-2 pr-8">
                    <h2 className="min-w-0 flex-1 truncate text-title">
                        {station.name}
                    </h2>
                    <StationHistoryLink station={station} />
                </div>
                <KindSwitch kind={kind} onChange={onKindChange} />
            </div>
        </>
    );
}

export function StationSheetBody({
    station,
    kind,
    onSelectTrain,
}: {
    station: Station;
    kind: BoardKind;
    onSelectTrain: (vehicleId: string) => void;
}) {
    return (
        <div className="flex flex-col gap-2 px-4 pb-6">
            <StationDisruptions stationId={station.id} />
            <BoardList
                station={station}
                kind={kind}
                onSelectTrain={onSelectTrain}
                wide={false}
            />
        </div>
    );
}

/** Desktop board panel: wide rows from 1024 px, the phone rows below. */
export function StationPanel({
    station,
    kind,
    onKindChange,
    onClose,
    onSelectTrain,
    wide,
}: {
    station: Station;
    kind: BoardKind;
    onKindChange: (kind: BoardKind) => void;
    onClose: () => void;
    onSelectTrain: (vehicleId: string) => void;
    wide: boolean;
}) {
    const t = useTranslations("Station");
    return (
        <section
            aria-label={t("board_of", { station: station.name })}
            className={cn(
                "floating-card flex h-full max-w-full flex-col overflow-hidden rounded-sheet",
                wide ? "w-[560px]" : "w-[400px]",
            )}
        >
            <div
                className={cn(
                    "flex border-b border-line p-4",
                    wide ? "items-center gap-3" : "flex-col gap-3",
                )}
            >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                    <BackButton onClick={onClose} />
                    <h2 className="min-w-0 flex-1 truncate text-title">
                        {station.name}
                    </h2>
                    {!wide && (
                        <StationHistoryLink
                            station={station}
                            className="size-9"
                        />
                    )}
                </div>
                <KindSwitch kind={kind} onChange={onKindChange} />
                {wide && (
                    <StationHistoryLink station={station} className="size-9" />
                )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4">
                <div className="pt-3 empty:hidden">
                    <StationDisruptions stationId={station.id} />
                </div>
                <BoardList
                    station={station}
                    kind={kind}
                    onSelectTrain={onSelectTrain}
                    wide={wide}
                />
            </div>
        </section>
    );
}
