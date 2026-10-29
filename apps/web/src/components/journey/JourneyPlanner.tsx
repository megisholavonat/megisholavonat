"use client";

import type {
    CityLeg,
    Itinerary,
    JourneyStop,
    Station,
    Transfer,
    TransitLeg,
    WalkLeg,
} from "@megisholavonat/api-client";
import {
    getStationBoardOptions,
    planJourneysOptions,
} from "@megisholavonat/api-client/react-query";
import { getDelayLevel } from "@megisholavonat/core/delay";
import {
    ANY_BUDAPEST,
    alightingElsewhere,
    boardingElsewhere,
    collapseTwinStations,
    isAnyBudapest,
    legChain,
    matchesBudapest,
} from "@megisholavonat/core/planner";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
    ArrowUpDown,
    ArrowUpRight,
    Building2,
    Footprints,
    MapPin,
    RefreshCw,
    X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
    DEFAULT_STATIONS,
    rememberStation,
    useRecentStations,
    useSearch,
} from "@/components/search/useSearch";
import { SheetClose } from "@/components/sheet/BottomSheet";
import {
    StationTypeIcon,
    StationTypeLabel,
} from "@/components/station/StationType";
import { BackButton, IconButton } from "@/components/train/TrainParts";
import { Button } from "@/components/ui/Button";
import { DelayChip } from "@/components/ui/Delay";
import { PlatformBadge } from "@/components/ui/Platform";
import { RouteGlyph } from "@/components/ui/RouteGlyph";
import {
    plannerResultExpanded,
    usePlannerSearched,
} from "@/lib/analyticsEvents";
import { cn } from "@/lib/utils";
import { CityChip } from "./CityChip";
import {
    formatTime,
    legDelays,
    RISK_FILL,
    RISK_TEXT,
    RISK_TINT,
    type RiskLevel,
    rides,
    transferGap,
    worstTransfer,
} from "./journey";
import type { PlannerState } from "./PlannerButton";
import { TimeRow } from "./TimeRow";

type Field = "from" | "to";

/** A station's name; "Budapest (any station)" in the reader's language. */
function useStationName() {
    const t = useTranslations("Journey");
    return (station: Station) =>
        isAnyBudapest(station) ? t("any_budapest") : station.name || "…";
}

/**
 * A station from a shared link is known by its id only: its name comes
 * with its board.
 */
function useStationNameLookup(
    station: Station | null,
    onFound: (station: Station) => void,
) {
    const stub = !!station && !station.name;
    const board = useQuery({
        ...getStationBoardOptions({
            path: { stationId: station?.id ?? "" },
            query: { limit: 1 },
        }),
        enabled: stub,
        staleTime: Number.POSITIVE_INFINITY,
    });
    const found = stub ? board.data?.station : undefined;
    const onFoundRef = useRef(onFound);
    onFoundRef.current = onFound;
    useEffect(() => {
        if (found) onFoundRef.current(found);
    }, [found]);
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
    // Both names may arrive before the next render
    const latest = useRef(state);
    latest.current = state;
    const found = (field: Field) => (station: Station) => {
        latest.current = { ...latest.current, [field]: station };
        onChange(latest.current);
    };
    useStationNameLookup(state.from, found("from"));
    useStationNameLookup(state.to, found("to"));

    const pick = (field: Field, station: Station) => {
        // Not a station with a board: kept out of the recent stations
        if (!isAnyBudapest(station)) rememberStation(station);
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
    const stationName = useStationName();
    const name = station ? stationName(station) : null;
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (editing) inputRef.current?.focus();
    }, [editing]);
    const label = t(field);
    return (
        <div className="focus-field flex h-11 items-center gap-3 rounded-md pr-2 pl-3.5">
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
                    placeholder={name ?? label}
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
                    aria-label={name ? `${label}: ${name}` : label}
                    className={cn(
                        "min-w-0 flex-1 cursor-text truncate text-left text-body",
                        station ? "text-ink" : "text-ink-2",
                    )}
                >
                    {name ?? label}
                </button>
            )}
            {/* Only a field with something in it has something to clear */}
            {editing && (query || station) && (
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
    const stationName = useStationName();
    const results = useSearch(query, undefined);
    const recent = useRecentStations();
    const typed = query.trim().length >= 2;
    const stations = (
        typed
            ? [
                  // First: the trains may leave from any of its stations
                  ...(matchesBudapest(query) ? [ANY_BUDAPEST] : []),
                  ...collapseTwinStations(results.stations),
              ]
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
                    {isAnyBudapest(station) ? (
                        <Building2
                            className="size-5 shrink-0 text-ink-2"
                            aria-hidden
                        />
                    ) : (
                        <StationTypeIcon
                            station={station}
                            className="size-5 shrink-0 text-ink-2"
                        />
                    )}
                    <span className="truncate text-body">
                        {stationName(station)}
                    </span>
                    <StationTypeLabel
                        station={station}
                        className="ml-auto shrink-0 pl-2"
                    />
                </button>
            ))}
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
                // Metro, tram and bus to and from the trains
                cityTransit: true,
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
    usePlannerSearched(
        key,
        plan,
        state.time !== null,
        !!state.from && !!state.to,
    );

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
                        fromId={state.from?.id}
                        toId={state.to?.id}
                        open={open === i}
                        onToggle={() => {
                            if (open !== i) plannerResultExpanded(i, itinerary);
                            setOpen(open === i ? null : i);
                        }}
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
    fromId,
    toId,
    open,
    onToggle,
}: {
    itinerary: Itinerary;
    fromId: string | undefined;
    toId: string | undefined;
    open: boolean;
    onToggle: () => void;
}) {
    const tTrain = useTranslations("Train");
    const t = useTranslations("Journey");
    const legs = rides(itinerary);
    const chain = legChain(itinerary);
    const boarding = boardingElsewhere(itinerary, fromId);
    const alighting = alightingElsewhere(itinerary, toId);
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
                {/* Beside the departure time, only a late start: a bare
                    "pontos" there would not say which train it means */}
                {firstDelay?.live &&
                    !first?.canceled &&
                    getDelayLevel(firstDelay.departure) !== "onTime" && (
                        // Says whose delay it is: the first train's start
                        <span className="flex items-center gap-1">
                            <span className="text-caption text-ink-2">
                                {tTrain("departs_at")}
                            </span>
                            <DelayChip delay={firstDelay.departure} />
                        </span>
                    )}
                <span className="ml-auto shrink-0 text-sm text-ink-2">
                    <Duration minutes={itinerary.durationMinutes} />
                </span>
            </span>
            {/* The chain wraps rather than running under the badge */}
            <span className="flex w-full min-w-0 items-start gap-2 text-sm text-ink-2">
                <span
                    data-testid="leg-chain"
                    className="flex min-h-6 min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1"
                >
                    {chain.map((leg, i) => (
                        <span
                            key={`${leg.type}-${leg.scheduledDeparture}-${leg.type === "city" ? leg.line : leg.tripId}`}
                            className="flex shrink-0 items-center gap-1"
                        >
                            {i > 0 && <span aria-hidden>›</span>}
                            {leg.type === "city" ? (
                                <CityChip leg={leg} />
                            ) : (
                                <>
                                    <RouteGlyph
                                        routeShortName={leg.routeShortName}
                                    />
                                    <span className="tnum text-ink">
                                        {leg.trainNumber}
                                    </span>
                                </>
                            )}
                        </span>
                    ))}
                </span>
                <span className="flex min-h-6 shrink-0 items-center gap-2">
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
            {(boarding || alighting) && (
                // The train leaves from (arrives at) another station than
                // the one picked: say which
                <span className="flex w-full min-w-0 items-center gap-1 text-caption font-semibold text-ink">
                    <MapPin className="size-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0 truncate">
                        {[
                            boarding &&
                                t("from_station", { station: boarding }),
                            alighting &&
                                t("to_station", { station: alighting }),
                        ]
                            .filter(Boolean)
                            .join(" · ")}
                    </span>
                </span>
            )}
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
    const t = useTranslations("Journey");
    const byCity = itinerary.legs.some((leg) => leg.type === "city");
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
                        {transfer && (
                            <TransferRow
                                transfer={transfer}
                                gap={transferGap(
                                    itinerary.legs[transfer.fromLeg],
                                    itinerary.legs[transfer.toLeg],
                                )}
                            />
                        )}
                        {leg.type === "transit" ? (
                            <RideBlock
                                leg={leg}
                                onSelectTrain={onSelectTrain}
                            />
                        ) : leg.type === "city" ? (
                            <CityBlock leg={leg} />
                        ) : (
                            <WalkRow leg={leg} />
                        )}
                    </div>
                );
            })}
            <Button variant="primary" asChild className="mt-3 flex gap-1">
                <a
                    href={itinerary.ticketUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    {tTrain("ticket")}
                    <ArrowUpRight className="size-4" aria-hidden />
                </a>
            </Button>
            {/* The MÁV ticket covers the trains only */}
            {byCity && (
                <p className="mt-1.5 text-center text-caption text-ink-2">
                    {t("city_ticket")}
                </p>
            )}
        </div>
    );
}

/** A metro, tram or bus ride: its line, then where it leaves and stops. */
function CityBlock({ leg }: { leg: CityLeg }) {
    return (
        <div className="flex flex-col" data-testid="city-leg">
            <StopLine
                stop={leg.fromStop}
                time={leg.scheduledDeparture}
                delay={0}
                live={false}
                canceled={false}
                terminal="start"
                minor
            />
            <div className="ml-[4px] flex min-h-8 items-center gap-1.5 border-l-2 border-dotted border-ink-2/40 py-1 pl-[18px] text-sm text-ink-2">
                <CityChip leg={leg} />
                {leg.headsign && (
                    <span className="min-w-0 truncate">→ {leg.headsign}</span>
                )}
            </div>
            <StopLine
                stop={leg.toStop}
                time={leg.scheduledArrival}
                delay={0}
                live={false}
                canceled={false}
                terminal="end"
                minor
            />
        </div>
    );
}

function TransferRow({
    transfer,
    gap,
}: {
    transfer: Transfer;
    /** From the times shown on the two legs */
    gap: { scheduled: number; expected: number } | null;
}) {
    const t = useTranslations("Journey");
    const level: RiskLevel | null =
        transfer.riskSource === "canceled"
            ? "likely_missed"
            : (transfer.risk ?? null);
    // The minutes add up with the times printed above and below; a live
    // forecast that differs is told beside them
    const scheduled = gap?.scheduled ?? Math.max(transfer.transferMinutes, 0);
    const expected =
        gap?.expected ?? Math.max(transfer.expectedTransferMinutes, 0);
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
                {expected !== scheduled
                    ? t("transfer_minutes_expected", {
                          m: scheduled,
                          e: expected,
                      })
                    : t("transfer_minutes", { m: scheduled })}
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
    minor = false,
}: {
    stop: JourneyStop;
    time: number;
    delay: number;
    live: boolean;
    canceled: boolean;
    terminal: "start" | "end";
    /** A city stop: smaller, so the trains stand out */
    minor?: boolean;
}) {
    return (
        <div
            className={cn(
                "flex items-center gap-3",
                minor ? "min-h-8 text-ink-2" : "min-h-10",
            )}
        >
            <span
                aria-hidden
                className={cn(
                    "size-2.5 shrink-0 rounded-full",
                    terminal === "start" ? "border-2 border-ink" : "bg-ink",
                )}
            />
            <span
                className={cn(
                    "tnum w-11 shrink-0 font-semibold",
                    minor ? "text-sm" : "text-subhead",
                    canceled && "text-ink-2 line-through",
                )}
            >
                {formatTime(time)}
            </span>
            {live && !canceled && delay > 0 ? (
                <DelayChip delay={delay} />
            ) : null}
            <span
                className={cn(
                    "min-w-0 flex-1 truncate",
                    minor ? "text-sm" : "text-subhead",
                )}
            >
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
                        <span className="size-1.5 shrink-0 motion-safe:animate-pulse rounded-full bg-delay-on-time-fill" />
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
