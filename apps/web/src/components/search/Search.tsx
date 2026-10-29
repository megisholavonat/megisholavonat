"use client";

import type {
    Station,
    TrainFeatureCollection,
    TrainFeatureProperties,
} from "@megisholavonat/api-client";
import { ArrowRight, Search as SearchIcon, Signpost, X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
    forwardRef,
    type KeyboardEvent,
    useEffect,
    useRef,
    useState,
} from "react";
import { TrainDelay } from "@/components/ui/Delay";
import { RouteGlyph } from "@/components/ui/RouteGlyph";
import { trainName, trainNumber } from "@/lib/train";
import { cn } from "@/lib/utils";
import {
    DEFAULT_STATIONS,
    splitMatch,
    useRecentStations,
    useSearch,
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
    return { query, setQuery, results, items, active, select, onKeyDown };
}

function ResultRow({
    item,
    query,
    active,
    index,
    onSelect,
}: {
    item: Item;
    query: string;
    active: boolean;
    index: number;
    onSelect: (item: Item) => void;
}) {
    const t = useTranslations("Search");
    const common = {
        id: `search-item-${index}`,
        role: "option",
        "aria-selected": active,
        type: "button" as const,
        onClick: () => onSelect(item),
        className: cn(
            "flex min-h-13 w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors",
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
    const { train } = item;
    const name = trainName(train.tripShortName);
    return (
        <button {...common}>
            <RouteGlyph
                routeShortName={train.routeShortName}
                className="min-w-5 text-center text-lg"
            />
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-body">
                <span className="tnum">
                    <Highlighted
                        text={trainNumber(train.tripShortName)}
                        query={query}
                    />
                </span>
                {name && (
                    <span className="truncate text-ink-2">
                        <Highlighted text={name} query={query} />
                    </span>
                )}
            </span>
            <TrainDelay train={train} chip />
        </button>
    );
}

function Results({ state }: { state: ReturnType<typeof useSearchState> }) {
    const t = useTranslations("Search");
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
                        onSelect={select}
                    />
                </div>
            ))}
        </div>
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
 * panel, which only drops its list down while focused.
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
    const done = () => {
        setFocused(false);
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

    // The compact list closes when focus leaves the card
    useEffect(() => {
        if (!compact || !focused) return;
        const onDown = (e: PointerEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setFocused(false);
        };
        window.addEventListener("pointerdown", onDown);
        return () => window.removeEventListener("pointerdown", onDown);
    }, [compact, focused]);

    const hasQuery = !!state.query.trim();
    const showList = !compact || focused || hasQuery;

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
                ) : (
                    <>
                        {!compact && home}
                        <QuickChips
                            stations={quick}
                            onSelect={(s) =>
                                state.select({ kind: "station", station: s })
                            }
                        />
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

/** Phones: results, or recent and quick stations, in the open home sheet. */
export function SheetSearchBody({
    state,
    handlers,
}: {
    state: SearchBox;
    handlers: SearchHandlers;
}) {
    const t = useTranslations("Search");
    const quick = useQuickStations();
    if (state.query.trim()) return <Results state={state} />;
    return (
        <section aria-label={t("stations")} className="flex flex-col">
            {quick.map((station) => (
                <button
                    key={station.id}
                    type="button"
                    onClick={() => handlers.onSelectStation(station)}
                    className="flex min-h-13 w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2/60"
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
    );
}
