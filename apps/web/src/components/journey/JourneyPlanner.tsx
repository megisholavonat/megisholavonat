"use client";

import type {
    Itinerary,
    JourneyStop,
    Station,
    Transfer,
    TransitLeg,
    WalkLeg,
} from "@megisholavonat/api-client";
import { planJourneysOptions } from "@megisholavonat/api-client/react-query";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
    ArrowUpDown,
    ArrowUpRight,
    Footprints,
    RefreshCw,
    Route as RouteIcon,
    Signpost,
    X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import {
    DEFAULT_STATIONS,
    rememberStation,
    useRecentStations,
    useSearch,
} from "@/components/search/useSearch";
import { SheetClose } from "@/components/sheet/BottomSheet";
import { BackButton, IconButton } from "@/components/train/TrainParts";
import { DelayChip } from "@/components/ui/Delay";
import { PlatformBadge } from "@/components/ui/Platform";
import { RouteGlyph } from "@/components/ui/RouteGlyph";
import { cn } from "@/lib/utils";
import {
    formatTime,
    legDelays,
    RISK_FILL,
    RISK_TEXT,
    RISK_TINT,
    type RiskLevel,
    rides,
    toLocalInput,
    worstTransfer,
} from "./journey";

type Field = "from" | "to";

export interface PlannerState {
    from: Station | null;
    to: Station | null;
    /** Local Budapest time "YYYY-MM-DDTHH:mm", or null for now */
    time: string | null;
    arriveBy: boolean;
}

export function usePlannerState() {
    const [state, setState] = useState<PlannerState>({
        from: null,
        to: null,
        time: null,
        arriveBy: false,
    });
    return [state, setState] as const;
}

/** Opens the planner: a round button next to the search. */
export function PlannerButton({
    onClick,
    className,
}: {
    onClick: () => void;
    className?: string;
}) {
    const t = useTranslations("Journey");
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={t("open")}
            title={t("open")}
            className={cn(
                "flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-surface-2 text-ink transition-colors hover:bg-line",
                className,
            )}
        >
            <RouteIcon className="size-5" aria-hidden />
        </button>
    );
}
/** Desktop: a floating panel in place of the home card. */
export function JourneyPanel(props: PlannerProps) {
    const t = useTranslations("Journey");
    return (
        <section
            aria-label={t("title")}
            className="floating-card flex h-full w-[440px] max-w-full flex-col overflow-hidden rounded-sheet"
        >
            <div className="flex items-center gap-3 px-4 pt-4 pb-1">
                <BackButton onClick={props.onClose} />
                <h2 className="min-w-0 flex-1 truncate text-title">
                    {t("title")}
                </h2>
            </div>
            <Planner {...props} />
        </section>
    );
}

/** Phones: the planner title in the bottom sheet (full detent). */
export function PlannerSheetHeader({ onClose }: { onClose: () => void }) {
    const t = useTranslations("Journey");
    return (
        <>
            <SheetClose onClick={onClose} />
            <h2 className="truncate px-4 pr-14 pb-1 text-title">
                {t("title")}
            </h2>
        </>
    );
}

/** Phones: the planner inside the bottom sheet; it scrolls itself. */
export function PlannerSheetBody(props: PlannerProps) {
    return <Planner {...props} />;
}

interface PlannerProps {
    state: PlannerState;
    onChange: (state: PlannerState) => void;
    onClose: () => void;
    onSelectTrain: (vehicleId: string) => void;
}

function Planner({
    state,
    onChange,
    onSelectTrain,
    phone = false,
}: PlannerProps & { phone?: boolean }) {
    const [editing, setEditing] = useState<Field | null>(
        state.from ? (state.to ? null : "to") : "from",
    );
    const [query, setQuery] = useState("");

    const pick = (field: Field, station: Station) => {
        rememberStation(station);
        const next = { ...state, [field]: station };
        onChange(next);
        setQuery("");
        setEditing(
            field === "from" && !next.to
                ? "to"
                : field === "to" && !next.from
                  ? "from"
                  : null,
        );
    };

    return (
        <>
            <div className="flex flex-col gap-3 px-4 pt-3 pb-3">
                <Endpoints
                    state={state}
                    editing={editing}
                    query={query}
                    onEdit={(field) => {
                        setEditing(field);
                        setQuery("");
                    }}
                    onQuery={setQuery}
                    onDone={() => setEditing(null)}
                    onSwap={() =>
                        onChange({ ...state, from: state.to, to: state.from })
                    }
                    surface={phone ? "bg-surface" : "bg-surface-2"}
                />
                {!editing && (
                    <TimeRow
                        state={state}
                        onChange={onChange}
                        surface={phone ? "bg-surface" : "bg-surface-2"}
                    />
                )}
            </div>
            <div
                className={cn(
                    "min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]",
                    phone ? "px-3" : "border-t border-line",
                )}
            >
                {editing ? (
                    <Suggestions
                        query={query}
                        exclude={editing === "from" ? state.to : state.from}
                        onPick={(s) => pick(editing, s)}
                        phone={phone}
                    />
                ) : state.from && state.to ? (
                    <Results
                        state={state}
                        onSelectTrain={onSelectTrain}
                        phone={phone}
                    />
                ) : null}
            </div>
        </>
    );
}

function Endpoints({
    state,
    editing,
    query,
    onEdit,
    onQuery,
    onDone,
    onSwap,
    surface,
}: {
    state: PlannerState;
    editing: Field | null;
    query: string;
    onEdit: (field: Field) => void;
    onQuery: (query: string) => void;
    onDone: () => void;
    onSwap: () => void;
    surface: string;
}) {
    const t = useTranslations("Journey");
    return (
        <div className="flex items-center gap-2">
            <div
                className={cn(
                    "relative flex min-w-0 flex-1 flex-col rounded-lg",
                    surface,
                )}
            >
                {(["from", "to"] as const).map((field) => (
                    <EndpointField
                        key={field}
                        field={field}
                        station={state[field]}
                        editing={editing === field}
                        query={query}
                        onEdit={() => onEdit(field)}
                        onQuery={onQuery}
                        onDone={onDone}
                    />
                ))}
                <span
                    aria-hidden
                    className="pointer-events-none absolute top-[22px] bottom-[22px] left-[19px] w-px border-l-2 border-dotted border-ink-2/50"
                />
                <span
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 right-0 left-10 h-px bg-line"
                />
            </div>
            <IconButton
                label={t("swap")}
                onClick={onSwap}
                className="size-10 bg-transparent hover:bg-surface-2"
            >
                <ArrowUpDown className="size-5" aria-hidden />
            </IconButton>
        </div>
    );
}

function EndpointField({
    field,
    station,
    editing,
    query,
    onEdit,
    onQuery,
    onDone,
}: {
    field: Field;
    station: Station | null;
    editing: boolean;
    query: string;
    onEdit: () => void;
    onQuery: (query: string) => void;
    onDone: () => void;
}) {
    const t = useTranslations("Journey");
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (editing) inputRef.current?.focus();
    }, [editing]);
    const label = t(field);
    return (
        <div className="flex h-11 items-center gap-3 pr-2 pl-3.5">
            <span
                aria-hidden
                className={cn(
                    "size-2.5 shrink-0 rounded-full",
                    field === "from" ? "border-2 border-ink" : "bg-ink",
                )}
            />
            {editing ? (
                <input
                    ref={inputRef}
                    type="search"
                    aria-label={label}
                    placeholder={station?.name ?? label}
                    value={query}
                    onChange={(e) => onQuery(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") onDone();
                    }}
                    autoComplete="off"
                    enterKeyHint="search"
                    className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-2 [&::-webkit-search-cancel-button]:hidden"
                />
            ) : (
                <button
                    type="button"
                    onClick={onEdit}
                    aria-label={station ? `${label}: ${station.name}` : label}
                    className={cn(
                        "min-w-0 flex-1 cursor-text truncate text-left text-body",
                        station ? "text-ink" : "text-ink-2",
                    )}
                >
                    {station?.name ?? label}
                </button>
            )}
            {editing && (
                <button
                    type="button"
                    onClick={onDone}
                    aria-label={t("done")}
                    className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-2"
                >
                    <X className="size-4" aria-hidden />
                </button>
            )}
        </div>
    );
}

function Suggestions({
    query,
    exclude,
    onPick,
    phone,
}: {
    query: string;
    exclude: Station | null;
    onPick: (station: Station) => void;
    phone: boolean;
}) {
    const tSearch = useTranslations("Search");
    const results = useSearch(query, undefined);
    const recent = useRecentStations();
    const typed = query.trim().length >= 2;
    const stations = (
        typed
            ? results.stations
            : [
                  ...recent,
                  ...DEFAULT_STATIONS.filter(
                      (d) => !recent.some((r) => r.id === d.id),
                  ),
              ].slice(0, 6)
    ).filter((s) => s.id !== exclude?.id);
    if (typed && stations.length === 0) {
        return (
            <p className="px-4 py-6 text-center text-ink-2">
                {results.loading ? "…" : tSearch("no_results")}
            </p>
        );
    }
    return (
        <div
            className={cn(
                "flex flex-col",
                phone && "mt-1 overflow-hidden rounded-lg bg-surface",
                !phone && "py-1",
            )}
        >
            {stations.map((station) => (
                <button
                    key={station.id}
                    type="button"
                    onClick={() => onPick(station)}
                    className={cn(
                        "flex min-h-13 w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2/60",
                        phone && "border-b border-line last:border-b-0",
                    )}
                >
                    <Signpost
                        className="size-5 shrink-0 text-ink-2"
                        aria-hidden
                    />
                    <span className="truncate text-body">{station.name}</span>
                </button>
            ))}
        </div>
    );
}

function TimeRow({
    state,
    onChange,
    surface,
}: {
    state: PlannerState;
    onChange: (state: PlannerState) => void;
    surface: string;
}) {
    const t = useTranslations("Journey");
    const id = useId();
    return (
        <div className="flex items-center gap-2">
            <div
                role="tablist"
                aria-label={t("time")}
                className={cn("grid grid-cols-2 rounded-md p-0.5", surface)}
            >
                {([false, true] as const).map((arriveBy) => (
                    <button
                        key={String(arriveBy)}
                        type="button"
                        role="tab"
                        aria-selected={state.arriveBy === arriveBy}
                        onClick={() => onChange({ ...state, arriveBy })}
                        className={cn(
                            "h-9 cursor-pointer rounded-[8px] px-3 text-sm transition-colors",
                            state.arriveBy === arriveBy
                                ? "bg-canvas font-semibold text-ink shadow-sm dark:bg-line"
                                : "text-ink-2",
                        )}
                    >
                        {t(arriveBy ? "arrive" : "depart")}
                    </button>
                ))}
            </div>
            <label htmlFor={id} className="sr-only">
                {t("time")}
            </label>
            <div
                className={cn(
                    "relative flex h-10 min-w-0 flex-1 items-center rounded-md px-3",
                    surface,
                )}
            >
                {state.time === null && (
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-semibold text-ink">
                        {t("now")}
                    </span>
                )}
                <input
                    id={id}
                    type="datetime-local"
                    value={state.time ?? toLocalInput(new Date())}
                    onChange={(e) =>
                        onChange({ ...state, time: e.target.value || null })
                    }
                    className={cn(
                        "tnum min-w-0 flex-1 bg-transparent text-sm text-ink outline-none",
                        state.time === null && "text-transparent",
                    )}
                />
            </div>
            {state.time !== null && (
                <button
                    type="button"
                    onClick={() => onChange({ ...state, time: null })}
                    className={cn(
                        "h-10 shrink-0 cursor-pointer rounded-md px-3 text-sm font-semibold text-ink",
                        surface,
                    )}
                >
                    {t("now")}
                </button>
            )}
        </div>
    );
}

function Results({
    state,
    onSelectTrain,
    phone,
}: {
    state: PlannerState;
    onSelectTrain: (vehicleId: string) => void;
    phone: boolean;
}) {
    const t = useTranslations("Journey");
    const tStates = useTranslations("States");
    const [open, setOpen] = useState<number | null>(null);
    const plan = useQuery({
        ...planJourneysOptions({
            query: {
                from: state.from?.id ?? "",
                to: state.to?.id ?? "",
                time: state.time ?? undefined,
                arriveBy: state.arriveBy,
                limit: 6,
            },
        }),
        enabled: !!state.from && !!state.to,
        // Live delays and risks move; following "now" also moves the window
        refetchInterval: 60_000,
        placeholderData: keepPreviousData,
    });
    const key = `${state.from?.id}-${state.to?.id}-${state.time}-${state.arriveBy}`;
    // biome-ignore lint/correctness/useExhaustiveDependencies: collapse on a new search
    useEffect(() => setOpen(null), [key]);

    if (plan.isPending) {
        return (
            <div className="flex flex-col gap-6 px-4 py-4" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex flex-col gap-2">
                        <span className="h-5 w-40 rounded-sm bg-surface-2" />
                        <span className="h-4 w-56 rounded-sm bg-surface-2" />
                    </div>
                ))}
            </div>
        );
    }
    if (plan.isError) {
        const same = plan.error?.response?.status === 422;
        return (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
                <p className="text-ink-2">
                    {same ? t("same_station") : tStates("load_error")}
                </p>
                {!same && (
                    <button
                        type="button"
                        className="flex h-10 cursor-pointer items-center gap-2 rounded-full bg-surface-2 px-4 text-sm font-semibold"
                        onClick={() => plan.refetch()}
                    >
                        <RefreshCw className="size-4" aria-hidden />
                        {tStates("retry")}
                    </button>
                )}
            </div>
        );
    }
    const itineraries = plan.data.itineraries;
    if (itineraries.length === 0) {
        return <p className="py-8 text-center text-ink-2">{t("empty")}</p>;
    }
    return (
        <ol
            className={cn(
                "flex flex-col",
                phone && "overflow-hidden rounded-lg bg-surface",
            )}
        >
            {itineraries.map((itinerary, i) => (
                <li
                    key={`${itinerary.scheduledDeparture}-${rides(itinerary)
                        .map((r) => r.tripId)
                        .join("-")}`}
                    className="border-b border-line last:border-b-0"
                >
                    <ItineraryRow
                        itinerary={itinerary}
                        open={open === i}
                        onToggle={() => setOpen(open === i ? null : i)}
                    />
                    {open === i && (
                        <ItineraryDetail
                            itinerary={itinerary}
                            onSelectTrain={onSelectTrain}
                        />
                    )}
                </li>
            ))}
        </ol>
    );
}

function Duration({ minutes }: { minutes: number }) {
    const t = useTranslations("Journey");
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return (
        <span className="tnum">
            {h > 0 ? t("duration_hours", { h, m }) : t("duration", { m })}
        </span>
    );
}

function ItineraryRow({
    itinerary,
    open,
    onToggle,
}: {
    itinerary: Itinerary;
    open: boolean;
    onToggle: () => void;
}) {
    const t = useTranslations("Journey");
    const legs = rides(itinerary);
    const first = legs[0];
    const firstDelay = first ? legDelays(first) : null;
    const canceled = legs.some((leg) => leg.canceled);
    const worst = worstTransfer(itinerary.transfers);
    return (
        <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className={cn(
                "flex w-full cursor-pointer flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-surface-2/60",
                open && "bg-surface-2/60",
            )}
        >
            <span className="flex w-full items-center gap-2">
                <span
                    className={cn(
                        "tnum text-headline font-bold",
                        canceled && "text-ink-2 line-through",
                    )}
                >
                    {formatTime(itinerary.scheduledDeparture)} –{" "}
                    {formatTime(itinerary.scheduledArrival)}
                </span>
                {firstDelay?.live && !first?.canceled && (
                    <DelayChip delay={firstDelay.departure} />
                )}
                <span className="ml-auto shrink-0 text-sm text-ink-2">
                    <Duration minutes={itinerary.durationMinutes} />
                </span>
            </span>
            <span className="flex w-full min-w-0 items-center gap-2 text-sm text-ink-2">
                <span className="flex min-w-0 items-center gap-1 truncate">
                    {legs.map((leg, i) => (
                        <span
                            key={`${leg.tripId}-${leg.scheduledDeparture}`}
                            className="flex shrink-0 items-center gap-1"
                        >
                            {i > 0 && <span aria-hidden>›</span>}
                            <RouteGlyph routeShortName={leg.routeShortName} />
                            <span className="tnum text-ink">
                                {leg.trainNumber}
                            </span>
                        </span>
                    ))}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-2">
                    {canceled ? (
                        <RiskPill level="likely_missed" label={t("canceled")} />
                    ) : worst?.risk && worst.risk !== "safe" ? (
                        <RiskPill level={worst.risk} />
                    ) : (
                        <span>
                            {itinerary.transferCount === 0
                                ? t("direct")
                                : t("changes", {
                                      count: itinerary.transferCount,
                                  })}
                        </span>
                    )}
                </span>
            </span>
        </button>
    );
}

function RiskPill({ level, label }: { level: RiskLevel; label?: string }) {
    const t = useTranslations("Journey");
    return (
        <span
            className={cn(
                "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2 text-caption font-bold",
                RISK_TINT[level],
                RISK_TEXT[level],
            )}
        >
            <span
                aria-hidden
                className={cn("size-2 rounded-full", RISK_FILL[level])}
            />
            {label ?? t(`risk_${level}`)}
        </span>
    );
}

function ItineraryDetail({
    itinerary,
    onSelectTrain,
}: {
    itinerary: Itinerary;
    onSelectTrain: (vehicleId: string) => void;
}) {
    const tTrain = useTranslations("Train");
    const transferTo = new Map<number, Transfer>(
        itinerary.transfers.map((tr) => [tr.toLeg, tr]),
    );
    return (
        <div className="flex flex-col gap-1 px-4 pt-1 pb-4">
            {itinerary.legs.map((leg, i) => {
                const transfer = transferTo.get(i);
                return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: legs keep their order
                    <div key={i} className="flex flex-col">
                        {transfer && <TransferRow transfer={transfer} />}
                        {leg.type === "transit" ? (
                            <RideBlock
                                leg={leg}
                                onSelectTrain={onSelectTrain}
                            />
                        ) : (
                            <WalkRow leg={leg} />
                        )}
                    </div>
                );
            })}
            <a
                href={itinerary.ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex h-11 items-center justify-center gap-1.5 rounded-full bg-action px-4 text-[15px] font-semibold text-on-action"
            >
                {tTrain("ticket")}
                <ArrowUpRight className="size-4" aria-hidden />
            </a>
        </div>
    );
}

function TransferRow({ transfer }: { transfer: Transfer }) {
    const t = useTranslations("Journey");
    const level: RiskLevel | null =
        transfer.riskSource === "canceled"
            ? "likely_missed"
            : (transfer.risk ?? null);
    const minutes =
        transfer.expectedTransferMinutes !== transfer.transferMinutes
            ? transfer.expectedTransferMinutes
            : transfer.transferMinutes;
    return (
        <div className="my-1 flex items-center gap-2 rounded-md bg-surface-2/70 px-3 py-2">
            {level ? (
                <RiskPill
                    level={level}
                    label={
                        transfer.riskSource === "canceled"
                            ? t("canceled")
                            : undefined
                    }
                />
            ) : null}
            <span className="tnum min-w-0 flex-1 truncate text-sm text-ink-2">
                {t("transfer_minutes", { m: Math.max(minutes, 0) })}
            </span>
        </div>
    );
}

function WalkRow({ leg }: { leg: WalkLeg }) {
    const t = useTranslations("Journey");
    const minutes = Math.max(
        1,
        Math.round((leg.arrivalTime - leg.departureTime) / 60),
    );
    return (
        <div className="flex items-center gap-3 py-1.5 pl-0.5 text-sm text-ink-2">
            <Footprints className="size-4 shrink-0" aria-hidden />
            <span>{t("walk", { m: minutes })}</span>
        </div>
    );
}

function StopLine({
    stop,
    time,
    delay,
    live,
    canceled,
    terminal,
}: {
    stop: JourneyStop;
    time: number;
    delay: number;
    live: boolean;
    canceled: boolean;
    terminal: "start" | "end";
}) {
    return (
        <div className="flex min-h-10 items-center gap-3">
            <span
                aria-hidden
                className={cn(
                    "size-2.5 shrink-0 rounded-full",
                    terminal === "start" ? "border-2 border-ink" : "bg-ink",
                )}
            />
            <span
                className={cn(
                    "tnum w-11 shrink-0 text-[15px] font-semibold",
                    canceled && "text-ink-2 line-through",
                )}
            >
                {formatTime(time)}
            </span>
            {live && !canceled && delay > 0 ? (
                <DelayChip delay={delay} />
            ) : null}
            <span className="min-w-0 flex-1 truncate text-[15px]">
                {stop.name}
            </span>
            <span className="flex w-9 shrink-0 justify-end">
                {stop.platform && <PlatformBadge platform={stop.platform} />}
            </span>
        </div>
    );
}

function RideBlock({
    leg,
    onSelectTrain,
}: {
    leg: TransitLeg;
    onSelectTrain: (vehicleId: string) => void;
}) {
    const t = useTranslations("Journey");
    const tStation = useTranslations("Station");
    const delays = legDelays(leg);
    const train = (
        <>
            <RouteGlyph routeShortName={leg.routeShortName} />
            <span className="tnum font-semibold text-ink">
                {leg.trainNumber}
            </span>
            {leg.headsign && (
                <span className="min-w-0 truncate">→ {leg.headsign}</span>
            )}
            {leg.canceled && (
                <span className="font-bold text-delay-severe">
                    {tStation("canceled")}
                </span>
            )}
        </>
    );
    return (
        <div className="flex flex-col">
            <StopLine
                stop={leg.fromStop}
                time={leg.scheduledDeparture}
                delay={delays.departure}
                live={delays.live}
                canceled={leg.canceled ?? false}
                terminal="start"
            />
            <div className="ml-[4px] flex min-h-9 items-center gap-1.5 border-l-2 border-ink-2/40 py-1 pl-[18px] text-sm text-ink-2">
                {leg.vehicleId ? (
                    <button
                        type="button"
                        onClick={() =>
                            leg.vehicleId && onSelectTrain(leg.vehicleId)
                        }
                        title={t("on_map")}
                        className="-mx-1.5 flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-0.5 hover:bg-surface-2"
                    >
                        {train}
                        <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-delay-on-time-fill" />
                    </button>
                ) : (
                    <span className="flex min-w-0 items-center gap-1.5">
                        {train}
                    </span>
                )}
            </div>
            <StopLine
                stop={leg.toStop}
                time={leg.scheduledArrival}
                delay={delays.arrival}
                live={delays.live}
                canceled={leg.canceled ?? false}
                terminal="end"
            />
        </div>
    );
}
