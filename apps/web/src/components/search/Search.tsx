"use client";

import type {
    Station,
    TrainFeatureCollection,
    TrainFeatureProperties,
} from "@megisholavonat/api-client";
import { trainDisplay } from "@megisholavonat/core/display";
import type {
    SortDirection,
    TrainSortOption,
} from "@megisholavonat/core/trainSearch";
import { liveSpeedKmh } from "@megisholavonat/core/trainSearch";
import {
    ArrowDown,
    ArrowRight,
    ArrowUp,
    ChevronLeft,
    ChevronRight,
    Search as SearchIcon,
    Signpost,
    TrainFront,
    X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
    forwardRef,
    type KeyboardEvent,
    useEffect,
    useRef,
    useState,
} from "react";
import { DelayChip } from "@/components/ui/Delay";
import { RouteGlyph } from "@/components/ui/RouteGlyph";
import { useNow } from "@/hooks/useNow";
import { trainName, trainNumber } from "@/lib/train";
import { cn } from "@/lib/utils";
import {
    DEFAULT_STATIONS,
    splitMatch,
    useRecentStations,
    useSearch,
    useTrainLists,
} from "./useSearch";

type Item =
    | { kind: "station"; station: Station }
    | { kind: "train"; train: TrainFeatureProperties };

export interface SearchHandlers {
    onSelectStation: (station: Station) => void;
    onSelectTrain: (train: TrainFeatureProperties) => void;
}

function Highlighted({ text, query }: { text: string; query: string }) {
    const parts = splitMatch(text, query);
    if (!parts) return <>{text}</>;
    return (
        <>
            {parts[0]}
            <b className="font-bold">{parts[1]}</b>
            {parts[2]}
        </>
    );
}

/** The search field: pill on surface-2, as on the home sheet and card. */
export const SearchField = forwardRef<
    HTMLInputElement,
    {
        value: string;
        onChange: (value: string) => void;
        onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
        onFocus?: () => void;
        autoFocus?: boolean;
        shortcut?: string;
        className?: string;
        activeId?: string;
    }
>(function SearchField(
    {
        value,
        onChange,
        onKeyDown,
        onFocus,
        autoFocus,
        shortcut,
        className,
        activeId,
    },
    ref,
) {
    const t = useTranslations("Search");
    return (
        <div
            className={cn(
                "flex h-11 min-w-0 items-center gap-2.5 rounded-full bg-surface-2 px-4",
                className,
            )}
        >
            <SearchIcon className="size-4.5 shrink-0 text-ink-2" aria-hidden />
            <input
                ref={ref}
                type="search"
                role="combobox"
                aria-expanded={value.length > 0}
                aria-controls="search-results"
                aria-activedescendant={activeId}
                aria-label={t("placeholder")}
                placeholder={t("placeholder")}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={onKeyDown}
                onFocus={onFocus}
                // biome-ignore lint/a11y/noAutofocus: the search screen opens to type
                autoFocus={autoFocus}
                autoComplete="off"
                enterKeyHint="search"
                className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-2 [&::-webkit-search-cancel-button]:hidden"
            />
            {value ? (
                <button
                    type="button"
                    onClick={() => onChange("")}
                    aria-label={t("clear")}
                    className="-mr-2 flex size-8 cursor-pointer items-center justify-center rounded-full text-ink-2"
                >
                    <X className="size-4" aria-hidden />
                </button>
            ) : (
                shortcut && (
                    <kbd className="rounded-sm border border-line px-1.5 text-caption text-ink-2">
                        {shortcut}
                    </kbd>
                )
            )}
        </div>
    );
});

export type SearchBox = ReturnType<typeof useSearchState>;

/** Query, results and keyboard navigation of one search field. */
export function useSearchState(
    trains: TrainFeatureCollection | undefined,
    handlers: SearchHandlers,
) {
    const [query, setQueryState] = useState("");
    const [active, setActive] = useState(0);
    const setQuery = (value: string) => {
        setQueryState(value);
        setActive(0);
    };
    const results = useSearch(query, trains);
    const items: Item[] = [
        ...results.stations.map((station) => ({
            kind: "station" as const,
            station,
        })),
        ...results.trains.map((train) => ({ kind: "train" as const, train })),
    ];
    const select = (item: Item) => {
        setQuery("");
        if (item.kind === "station") handlers.onSelectStation(item.station);
        else handlers.onSelectTrain(item.train);
    };
    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, items.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
        } else if (e.key === "Enter" && items[active]) {
            e.preventDefault();
            select(items[active]);
        }
    };
    return {
        query,
        setQuery,
        results,
        items,
        active,
        select,
        onKeyDown,
        trains,
    };
}

const rowClass =
    "flex min-h-13 w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors";

/**
 * A live train: glyph, "10 → Záhony", its speed while running and the delay
 * its map marker shows. The name joins the number only when the query
 * matched it.
 */
function TrainLine({
    train,
    query = "",
    now,
    keepSpeed = false,
}: {
    train: TrainFeatureProperties;
    query?: string;
    now: Date;
    /** Keep the speed on the narrowest phones too (the list sorts by it) */
    keepSpeed?: boolean;
}) {
    const t = useTranslations("Search");
    const number = trainNumber(train.tripShortName);
    const name = trainName(train.tripShortName);
    const destination = train.headsign ?? null;
    const showName =
        !!name &&
        (!destination ||
            (!!splitMatch(name, query) && !splitMatch(number, query)));
    const speed = liveSpeedKmh(train, now);
    const display = trainDisplay(train, now);
    return (
        <>
            <RouteGlyph
                routeShortName={train.routeShortName}
                className="min-w-5 text-center text-lg"
            />
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-body">
                <span className="tnum shrink-0 font-semibold">
                    <Highlighted text={number} query={query} />
                </span>
                {showName && (
                    <span
                        className={cn(
                            "truncate",
                            destination ? "shrink-[2]" : "text-ink-2",
                        )}
                    >
                        <Highlighted text={name} query={query} />
                    </span>
                )}
                {destination && (
                    <>
                        <ArrowRight
                            className="size-4 shrink-0 text-ink-2"
                            aria-hidden
                        />
                        <span className="truncate">
                            <Highlighted text={destination} query={query} />
                        </span>
                    </>
                )}
            </span>
            {speed !== null && speed > 0 && (
                <span
                    className={cn(
                        "tnum shrink-0 text-caption text-ink-2",
                        // Below 380 px the destination needs the room
                        !keepSpeed && "max-[379px]:hidden",
                    )}
                >
                    {t("speed", { speed })}
                </span>
            )}
            {/* None while it waits or has arrived, as on its marker */}
            {display.delay !== null && (
                <DelayChip
                    delay={display.delay}
                    stale={display.state !== "running"}
                    className="shrink-0"
                />
            )}
        </>
    );
}

/** Accessible name of a train row: "10, célállomás: Záhony". */
function useTrainLabel() {
    const t = useTranslations("Search");
    return (train: TrainFeatureProperties) => {
        const number = trainNumber(train.tripShortName);
        return train.headsign
            ? t("train_to", { train: number, destination: train.headsign })
            : train.tripShortName;
    };
}

function TrainButton({
    train,
    now,
    onSelect,
    keepSpeed,
}: {
    train: TrainFeatureProperties;
    now: Date;
    onSelect: (train: TrainFeatureProperties) => void;
    keepSpeed?: boolean;
}) {
    const label = useTrainLabel();
    return (
        <button
            type="button"
            onClick={() => onSelect(train)}
            title={label(train)}
            className={cn(
                rowClass,
                "hover:bg-surface-2/60 [content-visibility:auto] [contain-intrinsic-size:auto_52px]",
            )}
        >
            <TrainLine train={train} now={now} keepSpeed={keepSpeed} />
        </button>
    );
}

function ResultRow({
    item,
    query,
    active,
    index,
    now,
    onSelect,
}: {
    item: Item;
    query: string;
    active: boolean;
    index: number;
    now: Date;
    onSelect: (item: Item) => void;
}) {
    const t = useTranslations("Search");
    const trainLabel = useTrainLabel();
    const common = {
        id: `search-item-${index}`,
        role: "option",
        "aria-selected": active,
        type: "button" as const,
        onClick: () => onSelect(item),
        className: cn(
            rowClass,
            active ? "bg-surface-2" : "hover:bg-surface-2/60",
        ),
    };
    if (item.kind === "station") {
        return (
            <button
                {...common}
                aria-label={t("station_label", { station: item.station.name })}
            >
                <Signpost className="size-5 shrink-0 text-ink-2" aria-hidden />
                <span className="truncate text-body">
                    <Highlighted text={item.station.name} query={query} />
                </span>
            </button>
        );
    }
    return (
        <button {...common} title={trainLabel(item.train)}>
            <TrainLine train={item.train} query={query} now={now} />
        </button>
    );
}

function Results({ state }: { state: ReturnType<typeof useSearchState> }) {
    const t = useTranslations("Search");
    const now = new Date(useNow());
    const { query, items, active, select, results } = state;
    if (!query.trim()) return null;
    if (items.length === 0) {
        return (
            <p className="px-4 py-6 text-center text-ink-2">
                {results.loading ? "…" : t("no_results")}
            </p>
        );
    }
    const stationCount = results.stations.length;
    return (
        <div
            id="search-results"
            role="listbox"
            aria-label={t("results")}
            className="flex flex-col"
        >
            {items.map((item, i) => (
                <div
                    key={
                        item.kind === "station"
                            ? `s-${item.station.id}`
                            : `t-${item.train.vehicleId}`
                    }
                    className={cn(
                        i === stationCount &&
                            i > 0 &&
                            "mt-1 border-t border-line pt-1",
                    )}
                >
                    <ResultRow
                        item={item}
                        query={query}
                        active={i === active}
                        index={i}
                        now={now}
                        onSelect={select}
                    />
                </div>
            ))}
        </div>
    );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <h3 className="px-4 pt-3 pb-1 text-caption font-semibold tracking-wide text-ink-2 uppercase">
            {children}
        </h3>
    );
}

const SORTS: { value: TrainSortOption; initial: SortDirection }[] = [
    { value: "delay", initial: "desc" },
    { value: "number", initial: "asc" },
    { value: "speed", initial: "desc" },
];

/**
 * Under an empty field: the trains running late now, and the way into the
 * list of every train (as the app's search and train list).
 */
function LateTrains({
    trains,
    onSelect,
    onBrowse,
}: {
    trains: TrainFeatureCollection | undefined;
    onSelect: (train: TrainFeatureProperties) => void;
    onBrowse: () => void;
}) {
    const t = useTranslations("Search");
    const now = new Date(useNow());
    const { late } = useTrainLists(trains, "delay", "desc");
    if (!trains) return null;
    return (
        <section aria-label={t("late_now")} className="flex flex-col">
            {late.length > 0 && <SectionLabel>{t("late_now")}</SectionLabel>}
            {late.map((train) => (
                <TrainButton
                    key={train.vehicleId}
                    train={train}
                    now={now}
                    onSelect={onSelect}
                />
            ))}
            <button
                type="button"
                onClick={onBrowse}
                className={cn(
                    rowClass,
                    "hover:bg-surface-2/60",
                    late.length > 0 && "border-t border-line",
                )}
            >
                <TrainFront
                    className="size-5 shrink-0 text-ink-2"
                    aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-body font-semibold">
                    {t("all_trains")}
                </span>
                <span className="tnum text-caption text-ink-2">
                    {trains.features.length}
                </span>
                <ChevronRight className="size-4 text-ink-2" aria-hidden />
            </button>
        </section>
    );
}

/** Every train on the map, sortable by delay, number or speed. */
function AllTrains({
    trains,
    onSelect,
    onBack,
    stickyClassName,
}: {
    trains: TrainFeatureCollection | undefined;
    onSelect: (train: TrainFeatureProperties) => void;
    onBack: () => void;
    /** Where the header sticks inside its scroller */
    stickyClassName?: string;
}) {
    const t = useTranslations("Search");
    const now = new Date(useNow());
    const [sort, setSort] = useState<TrainSortOption>("delay");
    const [direction, setDirection] = useState<SortDirection>("desc");
    const { all } = useTrainLists(trains, sort, direction);
    const choose = (option: (typeof SORTS)[number]) => {
        if (option.value === sort) {
            setDirection((d) => (d === "asc" ? "desc" : "asc"));
        } else {
            setSort(option.value);
            setDirection(option.initial);
        }
    };
    const Arrow = direction === "asc" ? ArrowUp : ArrowDown;
    return (
        <section aria-label={t("all_trains")} className="flex flex-col">
            <div
                className={cn(
                    "sticky top-0 z-10 flex flex-col gap-2 bg-surface px-4 pt-1 pb-2",
                    stickyClassName,
                )}
            >
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onBack}
                        aria-label={t("back")}
                        title={t("back")}
                        className="-ml-2 flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink hover:bg-surface-2"
                    >
                        <ChevronLeft className="size-5" aria-hidden />
                    </button>
                    <h3 className="min-w-0 flex-1 truncate text-headline font-semibold">
                        {t("all_trains")}
                    </h3>
                    <span className="tnum text-caption text-ink-2">
                        {t("trains_count", { count: all.length })}
                    </span>
                </div>
                <fieldset className="grid grid-cols-3 rounded-md bg-surface-2 p-0.5">
                    <legend className="sr-only">{t("sort")}</legend>
                    {SORTS.map((option) => {
                        const selected = option.value === sort;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                aria-pressed={selected}
                                aria-label={
                                    selected
                                        ? `${t(`sort_${option.value}`)}, ${t(direction === "asc" ? "ascending" : "descending")}`
                                        : t(`sort_${option.value}`)
                                }
                                onClick={() => choose(option)}
                                className={cn(
                                    "flex h-8 cursor-pointer items-center justify-center gap-1 rounded-[8px] px-2 text-sm transition-colors",
                                    selected
                                        ? "bg-surface font-semibold text-ink shadow-sm"
                                        : "text-ink-2",
                                )}
                            >
                                {t(`sort_${option.value}`)}
                                {selected && (
                                    <Arrow
                                        className="size-3.5 shrink-0"
                                        aria-hidden
                                    />
                                )}
                            </button>
                        );
                    })}
                </fieldset>
            </div>
            {all.map((train) => (
                <TrainButton
                    key={train.vehicleId}
                    train={train}
                    now={now}
                    onSelect={onSelect}
                    keepSpeed={sort === "speed"}
                />
            ))}
        </section>
    );
}

function useQuickStations(): Station[] {
    const recent = useRecentStations();
    return recent.length > 0 ? recent.slice(0, 3) : DEFAULT_STATIONS;
}

/** Station chips under an empty desktop field. */
function QuickChips({
    stations,
    onSelect,
}: {
    stations: Station[];
    onSelect: (station: Station) => void;
}) {
    return (
        <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
            {stations.map((station) => (
                <button
                    key={station.id}
                    type="button"
                    onClick={() => onSelect(station)}
                    className="h-8 cursor-pointer rounded-full bg-surface-2 px-3 text-sm font-semibold text-ink transition-colors hover:bg-line"
                >
                    {station.name}
                </button>
            ))}
        </div>
    );
}

/**
 * Desktop search. In the home card it shows the followed trains and quick
 * stations under the field; `compact` is the floating field beside an open
 * panel, which only drops its list down while focused. While focused, the
 * empty field also drops down the late trains and the list of every train.
 */
export function DesktopSearch({
    trains,
    handlers,
    home,
    compact = false,
    trailing,
}: {
    trains: TrainFeatureCollection | undefined;
    handlers: SearchHandlers;
    /** Shown under the field while it is empty (the followed trains) */
    home?: React.ReactNode;
    compact?: boolean;
    /** Beside the field (compact) */
    trailing?: React.ReactNode;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const quick = useQuickStations();
    const [focused, setFocused] = useState(false);
    const [browsing, setBrowsing] = useState(false);
    const done = () => {
        setFocused(false);
        setBrowsing(false);
        inputRef.current?.blur();
    };
    const state = useSearchState(trains, {
        onSelectStation: (s) => {
            done();
            handlers.onSelectStation(s);
        },
        onSelectTrain: (train) => {
            done();
            handlers.onSelectTrain(train);
        },
    });

    // "/" focuses the search, like on most map sites
    useEffect(() => {
        const onKey = (e: globalThis.KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (
                e.key === "/" &&
                !e.metaKey &&
                !e.ctrlKey &&
                target?.tagName !== "INPUT" &&
                target?.tagName !== "TEXTAREA"
            ) {
                e.preventDefault();
                inputRef.current?.focus();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    // The drop-down closes when focus leaves the card
    useEffect(() => {
        if (!focused && !browsing) return;
        const onDown = (e: PointerEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) {
                setFocused(false);
                setBrowsing(false);
            }
        };
        window.addEventListener("pointerdown", onDown);
        return () => window.removeEventListener("pointerdown", onDown);
    }, [focused, browsing]);

    const hasQuery = !!state.query.trim();
    const open = focused || browsing;
    const showList = !compact || open || hasQuery;
    const selectTrain = (train: TrainFeatureProperties) =>
        state.select({ kind: "train", train });

    return (
        <div ref={rootRef} className="flex flex-col">
            <div
                className={cn(
                    "flex items-center gap-1",
                    compact ? "p-1.5" : "px-4 pb-3",
                )}
            >
                <SearchField
                    ref={inputRef}
                    value={state.query}
                    onChange={state.setQuery}
                    onFocus={() => setFocused(true)}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") {
                            e.stopPropagation();
                            state.setQuery("");
                            done();
                        }
                        state.onKeyDown(e);
                    }}
                    shortcut={compact ? undefined : "/"}
                    className="flex-1"
                    activeId={
                        state.items.length
                            ? `search-item-${state.active}`
                            : undefined
                    }
                />
                {trailing}
            </div>
            {showList &&
                (hasQuery ? (
                    <div className="max-h-[60vh] overflow-y-auto border-t border-line py-1">
                        <Results state={state} />
                    </div>
                ) : browsing ? (
                    <div className="max-h-[60vh] overflow-y-auto overscroll-contain border-t border-line pb-1">
                        <AllTrains
                            trains={trains}
                            onSelect={selectTrain}
                            onBack={() => {
                                setBrowsing(false);
                                inputRef.current?.focus();
                            }}
                            stickyClassName="pt-2"
                        />
                    </div>
                ) : (
                    <>
                        {!compact && home}
                        <QuickChips
                            stations={quick}
                            onSelect={(s) =>
                                state.select({ kind: "station", station: s })
                            }
                        />
                        {open && (
                            <div className="border-t border-line pb-1">
                                <LateTrains
                                    trains={trains}
                                    onSelect={selectTrain}
                                    onBrowse={() => setBrowsing(true)}
                                />
                            </div>
                        )}
                    </>
                ))}
        </div>
    );
}

/**
 * Phones: the search field in the home sheet. It is a real field from the
 * start, so a tap raises the keyboard at once; focusing it opens the sheet
 * into its search state, and Cancel, Esc or a drag down closes it.
 */
export function SheetSearchHeader({
    state,
    open,
    onOpen,
    onCancel,
    inputRef,
    trailing,
}: {
    state: SearchBox;
    open: boolean;
    onOpen: () => void;
    onCancel: () => void;
    inputRef: React.RefObject<HTMLInputElement | null>;
    /** Beside the field while the sheet is closed (the planner button) */
    trailing?: React.ReactNode;
}) {
    const t = useTranslations("Search");
    return (
        <div className="flex items-center gap-2">
            <SearchField
                ref={inputRef}
                value={state.query}
                onChange={(value) => {
                    if (!open) onOpen();
                    state.setQuery(value);
                }}
                onFocus={onOpen}
                onKeyDown={(e) => {
                    if (e.key === "Escape") {
                        e.stopPropagation();
                        onCancel();
                    }
                    state.onKeyDown(e);
                }}
                // Safari will not focus a field under user-select: none
                className="flex-1 select-text"
                activeId={
                    state.items.length
                        ? `search-item-${state.active}`
                        : undefined
                }
            />
            {open ? (
                <button
                    type="button"
                    onClick={onCancel}
                    className="h-11 shrink-0 cursor-pointer px-1 text-[15px] font-semibold text-ink"
                >
                    {t("cancel")}
                </button>
            ) : (
                trailing
            )}
        </div>
    );
}

/**
 * Phones: results, or quick stations, the late trains and the list of every
 * train, in the open home sheet.
 */
export function SheetSearchBody({
    state,
    handlers,
}: {
    state: SearchBox;
    handlers: SearchHandlers;
}) {
    const { trains } = state;
    const t = useTranslations("Search");
    const quick = useQuickStations();
    const [browsing, setBrowsing] = useState(false);
    if (state.query.trim()) return <Results state={state} />;
    if (browsing) {
        return (
            <AllTrains
                trains={trains}
                onSelect={handlers.onSelectTrain}
                onBack={() => setBrowsing(false)}
            />
        );
    }
    return (
        <div className="flex flex-col pb-2">
            <section aria-label={t("stations")} className="flex flex-col">
                {quick.map((station) => (
                    <button
                        key={station.id}
                        type="button"
                        onClick={() => handlers.onSelectStation(station)}
                        className={cn(rowClass, "hover:bg-surface-2/60")}
                    >
                        <Signpost
                            className="size-5 shrink-0 text-ink-2"
                            aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate text-body">
                            {station.name}
                        </span>
                        <ArrowRight className="size-4 text-ink-2" aria-hidden />
                    </button>
                ))}
            </section>
            <div className="mt-1 border-t border-line">
                <LateTrains
                    trains={trains}
                    onSelect={handlers.onSelectTrain}
                    onBrowse={() => setBrowsing(true)}
                />
            </div>
        </div>
    );
}
