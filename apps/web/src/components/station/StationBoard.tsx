"use client";

import type { BoardEntry, Station } from "@megisholavonat/api-client";
import { getStationBoardOptions } from "@megisholavonat/api-client/react-query";
import {
    DELAY_REASONS,
    type DelayReasonCode,
} from "@megisholavonat/core/delayReasons";
import type { Locale } from "@megisholavonat/core/i18n";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { SheetClose } from "@/components/sheet/BottomSheet";
import { StationHistoryLink } from "@/components/stats/HistoryLinks";
import { BackButton } from "@/components/train/TrainParts";
import { DelayChip } from "@/components/ui/Delay";
import { PlatformBadge } from "@/components/ui/Platform";
import { RouteGlyph } from "@/components/ui/RouteGlyph";
import { usePredictedPlatforms } from "@/hooks/usePredictedPlatforms";
import { trainNumber } from "@/lib/train";
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
                        "h-9 cursor-pointer rounded-[8px] px-4 text-sm transition-colors",
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
    onSelectTrain,
    wide,
}: {
    entry: BoardEntry;
    kind: BoardKind;
    predictedPlatform: string | null;
    onSelectTrain: (vehicleId: string) => void;
    wide: boolean;
}) {
    const t = useTranslations("Station");
    const locale = useLocale() as Locale;
    const number = trainNumber(entry.tripShortName);
    const place = entry.headsign
        ? kind === "arrivals"
            ? t("from", { station: entry.headsign })
            : entry.headsign
        : "";
    const reason = entry.reason?.code
        ? DELAY_REASONS[entry.reason.code as DelayReasonCode][locale]
        : null;
    const platform = entry.platform ?? predictedPlatform;
    const live = entry.realtime || entry.delaySource === "gps";
    const chip = entry.canceled ? (
        <span className="inline-flex h-5 items-center rounded-full bg-delay-severe-tint px-1.5 text-caption font-bold text-delay-severe">
            {t("canceled")}
        </span>
    ) : live ? (
        <DelayChip delay={entry.delayMinutes} />
    ) : null;
    const content = (
        <>
            <div
                className={cn(
                    "flex shrink-0 flex-col items-start gap-0.5",
                    wide ? "w-36 flex-row items-center gap-3" : "w-14",
                )}
            >
                <span
                    className={cn(
                        "tnum text-headline font-bold",
                        entry.canceled && "text-ink-2 line-through",
                    )}
                >
                    {formatTime(entry.scheduledTime)}
                </span>
                {chip}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-headline">
                    {place}
                    {wide && reason && (
                        <span className="ml-1.5 text-sm font-normal text-delay-severe">
                            {reason}
                        </span>
                    )}
                </span>
                {!wide && (
                    <span className="flex min-w-0 items-center gap-1 text-sm text-ink-2">
                        <RouteGlyph routeShortName={entry.routeShortName} />
                        <span className="tnum">{number}</span>
                        {reason && (
                            <span className="truncate text-delay-severe">
                                · {reason}
                            </span>
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
    const className =
        "flex w-full items-center gap-3 border-b border-line py-3 text-left last:border-b-0";
    return entry.vehicleId ? (
        <button
            type="button"
            className={cn(className, "cursor-pointer hover:bg-surface-2/60")}
            onClick={() => entry.vehicleId && onSelectTrain(entry.vehicleId)}
        >
            {content}
        </button>
    ) : (
        <div className={className}>{content}</div>
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
    const entries = board.data.entries;
    if (entries.length === 0) {
        return <p className="py-8 text-center text-ink-2">{t("empty")}</p>;
    }
    return (
        <div className="flex flex-col">
            {entries.map((entry) => (
                <BoardRow
                    key={`${entry.tripId}-${entry.serviceDate}`}
                    entry={entry}
                    kind={kind}
                    predictedPlatform={
                        predicted.get(trainNumber(entry.tripShortName)) ?? null
                    }
                    onSelectTrain={onSelectTrain}
                    wide={wide}
                />
            ))}
        </div>
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
                    <StationHistoryLink stationId={station.id} />
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
        <div className="px-4 pb-6">
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
                            stationId={station.id}
                            className="size-9"
                        />
                    )}
                </div>
                <KindSwitch kind={kind} onChange={onKindChange} />
                {wide && (
                    <StationHistoryLink
                        stationId={station.id}
                        className="size-9"
                    />
                )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4">
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
