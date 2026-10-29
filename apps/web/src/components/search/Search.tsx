"use client";

import type {
    Station,
    TrainFeatureCollection,
    TrainFeatureProperties,
} from "@megisholavonat/api-client";
import {
    ArrowRight,
    ChevronLeft,
    Search as SearchIcon,
    Signpost,
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

/** Looks like the search field; opens the search screen on phones. */
export function SearchTrigger({ onClick }: { onClick: () => void }) {
    const t = useTranslations("Search");
    return (
        <button
            type="button"
            onClick={onClick}
            className="flex h-11 w-full cursor-text items-center gap-2.5 rounded-full bg-surface-2 px-4 text-left text-body text-ink-2"
        >
            <SearchIcon className="size-4.5 shrink-0" aria-hidden />
            {t("placeholder")}
        </button>
    );
}

function useSearchState(
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
                className="w-5 text-center text-lg"
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

/** Desktop: the search block inside the home card. */
export function DesktopSearch({
    trains,
    handlers,
}: {
    trains: TrainFeatureCollection | undefined;
    handlers: SearchHandlers;
}) {
    const state = useSearchState(trains, handlers);
    const inputRef = useRef<HTMLInputElement>(null);
    const quick = useQuickStations();

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

    return (
        <div className="flex flex-col">
            <div className="px-4 pb-3">
                <SearchField
                    ref={inputRef}
                    value={state.query}
                    onChange={state.setQuery}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") {
                            state.setQuery("");
                            inputRef.current?.blur();
                        }
                        state.onKeyDown(e);
                    }}
                    shortcut="/"
                    activeId={
                        state.items.length
                            ? `search-item-${state.active}`
                            : undefined
                    }
                />
            </div>
            {state.query.trim() ? (
                <div className="max-h-[60vh] overflow-y-auto border-t border-line py-1">
                    <Results state={state} />
                </div>
            ) : (
                <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
                    {quick.map((station) => (
                        <button
                            key={station.id}
                            type="button"
                            onClick={() => handlers.onSelectStation(station)}
                            className="h-8 cursor-pointer rounded-full bg-surface-2 px-3 text-sm font-semibold text-ink hover:bg-line"
                        >
                            {station.name}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

/** Mobile: a full-screen search over the map. */
export function MobileSearch({
    trains,
    handlers,
    onClose,
}: {
    trains: TrainFeatureCollection | undefined;
    handlers: SearchHandlers;
    onClose: () => void;
}) {
    const t = useTranslations("Search");
    const state = useSearchState(trains, handlers);
    const quick = useQuickStations();
    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={t("placeholder")}
            className="fixed inset-0 z-40 flex flex-col bg-canvas pt-[env(safe-area-inset-top)]"
        >
            <div className="flex items-center gap-2 px-3 py-3">
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={t("back")}
                    className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink"
                >
                    <ChevronLeft className="size-6" aria-hidden />
                </button>
                <SearchField
                    value={state.query}
                    onChange={state.setQuery}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") onClose();
                        state.onKeyDown(e);
                    }}
                    autoFocus
                    className="flex-1 bg-surface"
                    activeId={
                        state.items.length
                            ? `search-item-${state.active}`
                            : undefined
                    }
                />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[env(safe-area-inset-bottom)]">
                {state.query.trim() ? (
                    <div className="overflow-hidden rounded-lg bg-surface">
                        <Results state={state} />
                    </div>
                ) : (
                    <div className="overflow-hidden rounded-lg bg-surface">
                        {quick.map((station) => (
                            <button
                                key={station.id}
                                type="button"
                                onClick={() =>
                                    handlers.onSelectStation(station)
                                }
                                className="flex min-h-13 w-full cursor-pointer items-center gap-3 border-b border-line px-4 py-2.5 text-left last:border-b-0"
                            >
                                <Signpost
                                    className="size-5 shrink-0 text-ink-2"
                                    aria-hidden
                                />
                                <span className="flex-1 truncate text-body">
                                    {station.name}
                                </span>
                                <ArrowRight
                                    className="size-4 text-ink-2"
                                    aria-hidden
                                />
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
