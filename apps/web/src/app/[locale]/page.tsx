"use client";

import type {
    Station,
    TrainFeatureCollection,
    TrainFeatureProperties,
} from "@megisholavonat/api-client";
import {
    getStationBoardOptions,
    getTrainsOptions,
} from "@megisholavonat/api-client/react-query";
import { POLL_INTERVAL_MS } from "@megisholavonat/core/constants";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import {
    type ReactNode,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";
import { MapProvider, useMap } from "react-map-gl/maplibre";
import { CommuteList, FollowHint } from "@/components/commute/CommuteList";
import type { FollowTarget } from "@/components/commute/FollowEditor";
import {
    followedVehicleIds,
    useCommute,
} from "@/components/commute/useCommute";
import {
    DisruptionChip,
    DisruptionsPanel,
    DisruptionsSheetBody,
    DisruptionsSheetHeader,
    useDisruptions,
} from "@/components/disruptions/Disruptions";
import {
    FeedMessage,
    feedState,
    LayersButton,
    Legend,
    SettingsButton,
    StaleBanner,
    Wordmark,
} from "@/components/home/HomeChrome";
import {
    PlannerButton,
    usePlannerState,
} from "@/components/journey/PlannerButton";
import {
    DesktopSearch,
    SheetSearchBody,
    SheetSearchHeader,
    useSearchState,
} from "@/components/search/Search";
import { rememberStation } from "@/components/search/useSearch";
import {
    BottomSheet,
    type Detent,
    FULL_TOP_GAP,
    halfHeight,
    useSheetViewport,
} from "@/components/sheet/BottomSheet";
import {
    type BoardKind,
    StationPanel,
    StationSheetBody,
    StationSheetHeader,
} from "@/components/station/StationBoard";
import { TrainPanel } from "@/components/train/TrainPanel";
import {
    TrainSheetBody,
    TrainSheetHeader,
} from "@/components/train/TrainSheet";
import { useTrainView } from "@/components/train/useTrainView";
import { useFocusReturn } from "@/hooks/useFocusReturn";
import { type Follow, useFollows } from "@/hooks/useFollows";
import { useIsDesktop } from "@/hooks/useIsMobile";
import { useMapAnalytics } from "@/hooks/useMapAnalytics";
import { useMapTitle } from "@/hooks/useMapTitle";
import { noteEntry } from "@/lib/analyticsEvents";
import { cn } from "@/lib/utils";
import type { FlyTarget, MapInsets } from "./MapComponent";

const DynamicMap = dynamic(() => import("./MapComponent"), {
    ssr: false,
    loading: () => <div className="h-full w-full bg-map" />,
});

// Behind a tap, so out of the first load: the planner, the settings (with
// their markdown changelog) and the follow editor. Fetched in idle time
// once the map is up (see usePrefetch), so they still open at once.
const loadPlanner = () => import("@/components/journey/JourneyPlanner");
const loadSettings = () => import("@/components/settings/Settings");
const loadFollowEditor = () => import("@/components/commute/FollowEditor");
/** Starts the planner's download as a finger or pointer reaches its button */
const prefetchPlanner = () => {
    void loadPlanner().catch(() => {});
};
const JourneyPanel = dynamic(() => loadPlanner().then((m) => m.JourneyPanel));
const PlannerSheetBody = dynamic(() =>
    loadPlanner().then((m) => m.PlannerSheetBody),
);
const PlannerSheetHeader = dynamic(() =>
    loadPlanner().then((m) => m.PlannerSheetHeader),
);
const SettingsDialog = dynamic(() =>
    loadSettings().then((m) => m.SettingsDialog),
);
const FollowEditor = dynamic(() =>
    loadFollowEditor().then((m) => m.FollowEditor),
);

/** Loads the deferred parts one per idle period, a while after first load */
function usePrefetch(ready: boolean) {
    useEffect(() => {
        if (!ready) return;
        const queue = [loadPlanner, loadSettings, loadFollowEditor];
        const hasIdle = typeof requestIdleCallback === "function";
        let handle: number | ReturnType<typeof setTimeout> | null = null;
        let cancelled = false;
        const next = () => {
            handle = null;
            const load = queue.shift();
            if (!load || cancelled) return;
            void load()
                .catch(() => {})
                .then(() => {
                    if (!cancelled) schedule();
                });
        };
        const schedule = () => {
            handle = hasIdle
                ? requestIdleCallback(next, { timeout: 4000 })
                : setTimeout(next, 200);
        };
        // Leave the first seconds to the map and the feed
        const start = setTimeout(schedule, PREFETCH_DELAY_MS);
        return () => {
            cancelled = true;
            clearTimeout(start);
            if (handle === null) return;
            if (hasIdle) cancelIdleCallback(handle as number);
            else clearTimeout(handle as ReturnType<typeof setTimeout>);
        };
    }, [ready]);
}

/** Desktop panels: width plus the 16 px gutters either side */
const GUTTER = 16;
const TRAIN_PANEL = 400;
const STATION_PANEL_WIDE = 560;
const STATION_PANEL_NARROW = 400;
const PLANNER_PANEL = 440;
/** The open search sheet leaves this share of the screen to the map */
const SEARCH_MAP_SHARE = 0.18;

const WIDE_QUERY = "(min-width: 1024px)";
const PREFETCH_DELAY_MS = 4000;

/** Wide desktop: the station board gets its roomy table layout. */
function useIsWide(): boolean {
    return useSyncExternalStore(
        (listener) => {
            const mq = window.matchMedia(WIDE_QUERY);
            mq.addEventListener("change", listener);
            return () => mq.removeEventListener("change", listener);
        },
        () => window.matchMedia(WIDE_QUERY).matches,
        () => true,
    );
}

function readParam(name: string): string | null {
    return new URLSearchParams(window.location.search).get(name);
}

/**
 * A layer over the map that has its own history entry. The train and the
 * station live in the URL (shareable); the others only in the entry's
 * state, so a reload reopens them but a shared link does not.
 */
type Overlay = "search" | "planner" | "disruptions";

interface Nav {
    vehicleId: string | null;
    station: string | null;
    overlay: Overlay | null;
}

/** What this app keeps in `history.state` (Next adds its own keys) */
interface NavEntry {
    mhav: 1;
    overlay: Overlay | null;
    /** The entry under this one, when this one was pushed on top of it */
    from: string | null;
}

const navKey = (nav: Nav) =>
    `${nav.vehicleId ?? ""}|${nav.station ?? ""}|${nav.overlay ?? ""}`;

function navEntry(): Partial<NavEntry> {
    const state = window.history.state as Partial<NavEntry> | null;
    return state?.mhav === 1 ? state : {};
}

function currentNav(): Nav {
    return {
        vehicleId: readParam("vehicleId"),
        station: readParam("station"),
        overlay: navEntry().overlay ?? null,
    };
}

/** `next` only takes layers off `current`: closing, not opening */
function isClose(current: Nav, next: Nav): boolean {
    return (
        (next.vehicleId === null || next.vehicleId === current.vehicleId) &&
        (next.station === null || next.station === current.station) &&
        (next.overlay === null || next.overlay === current.overlay)
    );
}

/** One train or station swapped for another of the same kind */
function isSwap(current: Nav, next: Nav): boolean {
    if (current.overlay !== next.overlay) return false;
    if (current.vehicleId && next.vehicleId) {
        return current.station === next.station;
    }
    return (
        !current.vehicleId &&
        !next.vehicleId &&
        !!current.station &&
        !!next.station
    );
}

/**
 * Mirrors the open layers in the session history, so the back button (and
 * Android's back gesture) closes the top layer instead of leaving the site.
 * Opening a layer pushes an entry; closing one goes back when the entry was
 * pushed on top of what remains, and replaces it otherwise (a shared link).
 * Swapping one train for another, and leaving search for its result,
 * replace the entry. Nothing is written while a back navigation is under
 * way: its popstate brings the state in line.
 */
function syncHistory(next: Nav, backPending: { current: boolean }) {
    if (backPending.current) return;
    const current = currentNav();
    const key = navKey(next);
    if (navKey(current) === key) return;
    const entry = navEntry();
    const params = new URLSearchParams(window.location.search);
    for (const [name, value] of [
        ["vehicleId", next.vehicleId],
        ["station", next.station],
    ] as const) {
        if (value) params.set(name, value);
        else params.delete(name);
    }
    const search = params.toString();
    const url = `${window.location.pathname}${search ? `?${search}` : ""}`;
    const write = (mode: "push" | "replace", from: string | null) => {
        const state: NavEntry = { mhav: 1, overlay: next.overlay, from };
        if (mode === "push") window.history.pushState(state, "", url);
        else window.history.replaceState(state, "", url);
    };

    const close = isClose(current, next);
    if (close && entry.from === key) {
        backPending.current = true;
        window.history.back();
    } else if (close) {
        write("replace", null);
    } else if (
        isSwap(current, next) ||
        (current.overlay === "search" && next.overlay !== "search")
    ) {
        write("replace", entry.from ?? null);
    } else {
        write("push", navKey(current));
    }
}

type NoticeKind = "train_gone" | "station_unknown";

/**
 * The API said no (a 404 for an unknown station, a 422 for a malformed
 * id), as opposed to a lost request or a server error worth retrying.
 */
function isApiError(error: unknown): boolean {
    const status = (error as { response?: { status?: number } } | null)
        ?.response?.status;
    return typeof status === "number" && status >= 400 && status < 500;
}

/** A short note at the top of the map that goes away by itself */
function Notice({
    kind,
    onDone,
}: {
    kind: NoticeKind | null;
    onDone: () => void;
}) {
    const t = useTranslations("Shell");
    const reduced = useReducedMotion() ?? false;
    useEffect(() => {
        if (!kind) return;
        const timer = window.setTimeout(onDone, 5000);
        return () => window.clearTimeout(timer);
    }, [kind, onDone]);
    return (
        <div role="status" className="flex justify-center">
            <AnimatePresence>
                {kind && (
                    <motion.div
                        key={kind}
                        initial={{ opacity: 0, y: reduced ? 0 : -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: reduced ? 0 : -8 }}
                        transition={{ duration: 0.24, ease: "easeOut" }}
                        className="floating-card flex min-h-9 items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold dark:ring-1 dark:ring-line"
                    >
                        <Info className="size-4 shrink-0" aria-hidden />
                        {t(kind)}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

/** Close to the old panel spring (damping 30, stiffness 300), in ~220 ms */
const PANEL_SPRING = {
    type: "spring",
    visualDuration: 0.22,
    bounce: 0,
} as const;

/** Desktop: a panel docked top-left that slides and fades in and out. */
function DockedPanel({
    children,
    className,
    style,
}: {
    children: ReactNode;
    className?: string;
    style?: React.CSSProperties;
}) {
    const reduced = useReducedMotion() ?? false;
    return (
        <motion.div
            className={cn("absolute z-30", className)}
            style={style}
            initial={{ opacity: 0, x: reduced ? 0 : -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: reduced ? 0 : -24 }}
            transition={reduced ? { duration: 0 } : PANEL_SPRING}
        >
            {children}
        </motion.div>
    );
}

/**
 * Keeps the selected train clear of the sheet or side panel: when it is
 * selected, or the sheet changes height, and the train sits under the
 * covered part, the map eases so it shows in the open part.
 */
function KeepTrainVisible({
    selectedId,
    trains,
    insets,
}: {
    selectedId: string | null;
    trains: TrainFeatureCollection | undefined;
    insets: MapInsets;
}) {
    const { default: map } = useMap();
    const reduced = useReducedMotion() ?? false;
    const trainsRef = useRef(trains);
    useEffect(() => {
        trainsRef.current = trains;
    }, [trains]);
    const { bottom, left } = insets;

    useEffect(() => {
        if (!map || !selectedId) return;
        // Let a flight that this selection started take the lead
        const timer = window.setTimeout(() => {
            if (map.isMoving()) return;
            const feature = trainsRef.current?.features.find(
                (f) => f.properties.vehicleId === selectedId,
            );
            if (!feature) return;
            const { lon, lat } = feature.properties;
            const point = map.project([lon, lat]);
            const container = map.getContainer();
            const margin = 48;
            const visible =
                point.x >= left + margin &&
                point.x <= container.clientWidth - margin &&
                point.y >= 72 &&
                point.y <= container.clientHeight - bottom - margin;
            if (visible) return;
            map.easeTo({
                center: [lon, lat],
                padding: { top: 0, right: 0, bottom, left },
                duration: reduced ? 0 : 600,
            });
        }, 80);
        return () => window.clearTimeout(timer);
    }, [map, selectedId, bottom, left, reduced]);

    return null;
}

export default function MapPage() {
    return (
        <MapProvider>
            <MapScreen />
        </MapProvider>
    );
}

function MapScreen() {
    const locale = useLocale();
    const tHome = useTranslations("Home");
    const tTrain = useTranslations("Train");
    const tStation = useTranslations("Station");
    const tJourney = useTranslations("Journey");
    const tDisruptions = useTranslations("Disruptions");
    const tShell = useTranslations("Shell");
    const isDesktop = useIsDesktop();
    const isWide = useIsWide();
    const sheetViewport = useSheetViewport();

    const trainsQuery = useQuery({
        ...getTrainsOptions(),
        refetchInterval: POLL_INTERVAL_MS,
    });
    const trains = trainsQuery.data;
    usePrefetch(!!trains);
    const feed = feedState(trains, trainsQuery.isError, trainsQuery.isPending);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    // Closing the train puts focus back on the row that opened it
    useFocusReturn(selectedId);
    const [stationId, setStationId] = useState<string | null>(null);
    const [pickedStation, setPickedStation] = useState<Station | null>(null);
    const [boardKind, setBoardKind] = useState<BoardKind>("departures");
    const [trainDetent, setTrainDetent] = useState<Detent>("peek");
    const [stationDetent, setStationDetent] = useState<Detent>("half");
    const [searchOpen, setSearchOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [plannerOpen, setPlannerOpen] = useState(false);
    const [planner, setPlanner] = usePlannerState();
    const [disruptionsOpen, setDisruptionsOpen] = useState(false);
    const [disruptionsDetent, setDisruptionsDetent] = useState<Detent>("half");
    const disruptions = useDisruptions();
    const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null);
    const [followTarget, setFollowTarget] = useState<FollowTarget | null>(null);
    // Mounted from their first use on, so they can animate closed
    const [settingsUsed, setSettingsUsed] = useState(false);
    if (settingsOpen && !settingsUsed) setSettingsUsed(true);
    const [followUsed, setFollowUsed] = useState(false);
    if (followTarget && !followUsed) setFollowUsed(true);
    const [peekHeight, setPeekHeight] = useState(140);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const follows = useFollows();
    const commute = useCommute(follows, trains);
    // Stable while the same vehicles are followed, so the map keeps its data
    const followedKey = [...followedVehicleIds(commute)].sort().join(",");
    const followedIds = useMemo(
        () => new Set(followedKey ? followedKey.split(",") : []),
        [followedKey],
    );
    const [urlRead, setUrlRead] = useState(false);
    const pendingFlyRef = useRef<string | null>(null);

    const [notice, setNotice] = useState<NoticeKind | null>(null);
    const clearNotice = useCallback(() => setNotice(null), []);
    const backPendingRef = useRef(false);
    /** From a shared link or a reload: say so when it no longer exists */
    const restoredStationRef = useRef<string | null>(null);

    // Restore the selection (and, after a reload, the open layer) once
    useEffect(() => {
        const { vehicleId, station, overlay } = currentNav();
        if (vehicleId) {
            setSelectedId(vehicleId);
            pendingFlyRef.current = vehicleId;
        }
        if (station) {
            setStationId(station);
            restoredStationRef.current = station;
        }
        if (overlay === "search") setSearchOpen(true);
        if (overlay === "planner") setPlannerOpen(true);
        if (overlay === "disruptions") setDisruptionsOpen(true);
        setUrlRead(true);
    }, []);

    const overlay: Overlay | null = searchOpen
        ? "search"
        : plannerOpen
          ? "planner"
          : disruptionsOpen
            ? "disruptions"
            : null;

    /** The layers as last rendered, for a popstate that lands before the
     * effect below has mirrored them */
    const navRef = useRef<Nav>({ vehicleId: null, station: null, overlay });
    navRef.current = { vehicleId: selectedId, station: stationId, overlay };

    // Mirror the layers in the URL and the history (shareable; back closes
    // the top one; the consent prompt watches ?vehicleId for a closed panel)
    useEffect(() => {
        if (!urlRead) return;
        syncHistory(
            { vehicleId: selectedId, station: stationId, overlay },
            backPendingRef,
        );
    }, [selectedId, stationId, overlay, urlRead]);

    const board = useQuery({
        ...getStationBoardOptions({
            path: { stationId: stationId ?? "" },
            query: { kind: boardKind, limit: 30 },
        }),
        enabled: !!stationId,
        // An unknown station answers 404 at once; only network trouble retries
        retry: (count, error) => !isApiError(error) && count < 3,
    });
    const station = useMemo((): Station | null => {
        if (!stationId) return null;
        if (pickedStation?.id === stationId) return pickedStation;
        return board.data?.station ?? null;
    }, [stationId, pickedStation, board.data]);

    // A station that does not exist (a bad or outdated link) is dropped
    // from the URL, with a note instead of an empty map
    useEffect(() => {
        if (!stationId || station || !isApiError(board.error)) return;
        if (restoredStationRef.current === stationId) {
            setNotice("station_unknown");
        }
        setStationId(null);
    }, [stationId, station, board.error]);

    // A station restored from the URL is flown to once its board names it
    const flewToStationRef = useRef<string | null>(null);
    useEffect(() => {
        if (!station || flewToStationRef.current === station.id) return;
        flewToStationRef.current = station.id;
        if (pickedStation?.id === station.id) return;
        setFlyTarget({
            lon: station.lon,
            lat: station.lat,
            zoom: 13,
            key: Date.now(),
        });
    }, [station, pickedStation]);

    const fallback = useMemo(
        (): TrainFeatureProperties | null =>
            trains?.features.find((f) => f.properties.vehicleId === selectedId)
                ?.properties ?? null,
        [trains, selectedId],
    );
    const { view: trainView, isError: trainGone } = useTrainView(
        selectedId,
        fallback,
    );
    useMapTitle({
        selectedId,
        train: trainView,
        stationId,
        stationName: station?.name,
    });

    const flyToTrain = useCallback(
        (vehicleId: string) => {
            const feature = trains?.features.find(
                (f) => f.properties.vehicleId === vehicleId,
            );
            if (!feature) return false;
            setFlyTarget({
                lon: feature.properties.lon,
                lat: feature.properties.lat,
                zoom: 12,
                key: Date.now(),
            });
            return true;
        },
        [trains],
    );

    // Fly to a train restored from the URL, or drop it if it is gone
    useEffect(() => {
        const pending = pendingFlyRef.current;
        if (!pending || !trains) return;
        pendingFlyRef.current = null;
        if (!flyToTrain(pending)) {
            setSelectedId(null);
            setNotice("train_gone");
        }
    }, [trains, flyToTrain]);

    // Close the sheet only when the train has also left the live feed; a
    // failed refresh keeps showing the last details
    useEffect(() => {
        if (trainGone && trains && !fallback) setSelectedId(null);
    }, [trainGone, trains, fallback]);

    const closeSearch = useCallback(() => {
        setSearchOpen(false);
        searchInputRef.current?.blur();
    }, []);

    const selectTrain = useCallback(
        (vehicleId: string | null, detent: Detent = "peek") => {
            setSelectedId(vehicleId);
            if (vehicleId) {
                setTrainDetent(detent);
                closeSearch();
            }
        },
        [closeSearch],
    );

    const openTrainFromList = useCallback(
        (vehicleId: string) => {
            selectTrain(vehicleId, "half");
            flyToTrain(vehicleId);
        },
        [selectTrain, flyToTrain],
    );

    const openStation = useCallback((s: Station) => {
        rememberStation(s);
        setPickedStation(s);
        setStationId(s.id);
        setSelectedId(null);
        setStationDetent("half");
        setBoardKind("departures");
        setFlyTarget({ lon: s.lon, lat: s.lat, zoom: 13, key: Date.now() });
    }, []);

    const searchHandlers = useMemo(
        () => ({
            onSelectStation: (s: Station) => {
                noteEntry("search");
                closeSearch();
                openStation(s);
            },
            onSelectTrain: (train: TrainFeatureProperties) => {
                noteEntry("search");
                closeSearch();
                openTrainFromList(train.vehicleId);
            },
        }),
        [closeSearch, openStation, openTrainFromList],
    );
    const sheetSearch = useSearchState(trains, searchHandlers);
    const cancelSearch = () => {
        sheetSearch.setQuery("");
        closeSearch();
    };

    const closeTrain = useCallback(() => setSelectedId(null), []);
    const followTrain = useCallback(() => {
        if (trainView) setFollowTarget({ kind: "train", view: trainView });
    }, [trainView]);
    const editFollow = useCallback(
        (follow: Follow) => setFollowTarget({ kind: "follow", follow }),
        [],
    );
    const closeStation = useCallback(() => {
        setStationId(null);
        setPickedStation(null);
    }, []);
    const closePlanner = useCallback(() => setPlannerOpen(false), []);
    const openPlanner = useCallback(() => {
        setSearchOpen(false);
        setPlannerOpen(true);
    }, []);
    const closeDisruptions = useCallback(() => setDisruptionsOpen(false), []);
    const openDisruptions = useCallback(() => {
        setDisruptionsDetent("half");
        setDisruptionsOpen(true);
    }, []);

    // Back and forward: take the layers from the entry. The listener is
    // added once, in the capture phase: Next's own popstate listener can
    // commit a render, and a listener re-added by that render's effects
    // would miss the event it is being dispatched for.
    const clearQueryRef = useRef(sheetSearch.setQuery);
    clearQueryRef.current = sheetSearch.setQuery;
    useEffect(() => {
        const onPop = () => {
            if (backPendingRef.current) {
                // The back this page started to close a layer. The layers
                // on screen are already right, and another may have closed
                // while it was under way (Esc twice): the URL is behind
                // them, so bring it along instead of reopening that one
                backPendingRef.current = false;
                const wanted = navRef.current;
                if (wanted.overlay !== "search") clearQueryRef.current("");
                syncHistory(wanted, backPendingRef);
                return;
            }
            const nav = currentNav();
            setSelectedId(nav.vehicleId);
            setStationId(nav.station);
            if (nav.overlay !== "search") {
                clearQueryRef.current("");
                closeSearch();
            } else setSearchOpen(true);
            setPlannerOpen(nav.overlay === "planner");
            setDisruptionsOpen(nav.overlay === "disruptions");
        };
        window.addEventListener("popstate", onPop, true);
        return () => window.removeEventListener("popstate", onPop, true);
    }, [closeSearch]);

    // Esc closes the top layer only. A dialog or popover that is open when
    // the key goes down takes it alone: that is checked before either
    // handles the key, since they close themselves and re-render the page
    // before the key reaches the window.
    const escRef = useRef(() => {});
    escRef.current = () => {
        if (settingsOpen || followTarget) return;
        if (searchOpen) {
            sheetSearch.setQuery("");
            closeSearch();
        } else if (selectedId) closeTrain();
        else if (stationId) closeStation();
        else if (plannerOpen) closePlanner();
        else if (disruptionsOpen) closeDisruptions();
    };
    useEffect(() => {
        let blocked = false;
        const onKeyCapture = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            // One still fading out after it closed does not count
            blocked = !!document.querySelector(
                [
                    '[role="dialog"]:not([data-sheet]):not([data-state="closed"])',
                    '[role="alertdialog"]:not([data-state="closed"])',
                    '[data-radix-popper-content-wrapper]:not(:has(> [data-state="closed"]))',
                ].join(","),
            );
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || blocked || e.defaultPrevented) return;
            escRef.current();
        };
        window.addEventListener("keydown", onKeyCapture, true);
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("keydown", onKeyCapture, true);
            window.removeEventListener("keydown", onKey);
        };
    }, []);

    useMapAnalytics({
        trains,
        feed: feed.kind,
        isDesktop,
        selectedId,
        fallback,
        trainView,
        followed: followedIds,
        trainDetent,
        stationId,
        stationLoaded: !!station,
        stationDetent,
        boardKind,
        searchOpen,
        plannerOpen,
        disruptionsOpen,
        disruptionsDetent,
        disruptionCount: disruptions.length,
        notice,
    });

    const showTrain = !!selectedId;
    const showStation = !showTrain && !!stationId && !!station;
    const showPlanner = !showTrain && !showStation && plannerOpen;
    const showDisruptions =
        !showTrain && !showStation && !showPlanner && disruptionsOpen;
    const desktopPanel = showTrain
        ? "train"
        : showStation
          ? "station"
          : showPlanner
            ? "planner"
            : showDisruptions
              ? "disruptions"
              : "home";
    const panelWidth =
        desktopPanel === "train"
            ? TRAIN_PANEL
            : desktopPanel === "station"
              ? isWide
                  ? STATION_PANEL_WIDE
                  : STATION_PANEL_NARROW
              : desktopPanel === "planner"
                ? PLANNER_PANEL
                : desktopPanel === "disruptions"
                  ? TRAIN_PANEL
                  : 0;
    /** Map left of this is under the side panel */
    const panelLeft = panelWidth ? panelWidth + 2 * GUTTER : 0;

    const sheetMode = desktopPanel;
    const baseDetent: Detent =
        sheetMode === "train"
            ? trainDetent
            : sheetMode === "station"
              ? stationDetent
              : sheetMode === "planner" || searchOpen
                ? "full"
                : "peek";
    const sheetDetent =
        sheetMode === "disruptions" ? disruptionsDetent : baseDetent;
    const sheetFull = sheetDetent === "full";
    const searchGap = Math.max(
        FULL_TOP_GAP,
        Math.round(sheetViewport.height * SEARCH_MAP_SHARE),
    );

    // The part of the map under the sheet or panel. A full sheet counts as
    // half: the map strip above it is too thin to aim at.
    const insets = useMemo((): MapInsets => {
        if (isDesktop) return { bottom: 0, left: panelLeft };
        const half = halfHeight(sheetViewport.height);
        return {
            bottom: sheetDetent === "peek" ? peekHeight : half,
            left: 0,
        };
    }, [isDesktop, panelLeft, sheetDetent, peekHeight, sheetViewport.height]);

    const retry = () => {
        void trainsQuery.refetch();
    };

    const homeHeader = (
        <div className="flex flex-col gap-4 px-4 pb-[max(env(safe-area-inset-bottom),16px)]">
            <SheetSearchHeader
                state={sheetSearch}
                open={searchOpen}
                onOpen={() => setSearchOpen(true)}
                onCancel={cancelSearch}
                inputRef={searchInputRef}
                trailing={
                    <PlannerButton
                        onClick={openPlanner}
                        onIntent={prefetchPlanner}
                    />
                }
            />
            {!searchOpen && (
                <DisruptionChip
                    disruptions={disruptions}
                    follows={follows}
                    onClick={openDisruptions}
                    className="-mt-1"
                />
            )}
            {!searchOpen &&
                (follows.length > 0 ? (
                    <CommuteList
                        rows={commute}
                        onOpenTrain={openTrainFromList}
                        onEdit={editFollow}
                    />
                ) : (
                    feed.kind === "ok" && (
                        <FollowHint
                            onClick={() => searchInputRef.current?.focus()}
                        />
                    )
                ))}
            {!searchOpen && <FeedMessage state={feed} onRetry={retry} />}
        </div>
    );

    const baseSheet =
        sheetMode === "train"
            ? {
                  label: tTrain("sheet_label"),
                  detents: ["peek", "half", "full"] as Detent[],
                  onDetentChange: setTrainDetent,
                  onDismiss: closeTrain,
                  header: (
                      <TrainSheetHeader
                          view={trainView}
                          fallback={fallback}
                          detent={trainDetent}
                          onClose={closeTrain}
                          onFollow={followTrain}
                      />
                  ),
                  body: (
                      <TrainSheetBody
                          view={trainView}
                          detent={trainDetent}
                          onFollow={followTrain}
                      />
                  ),
              }
            : sheetMode === "station" && station
              ? {
                    label: tStation("board_of", { station: station.name }),
                    detents: ["half", "full"] as Detent[],
                    onDetentChange: setStationDetent,
                    onDismiss: closeStation,
                    header: (
                        <StationSheetHeader
                            station={station}
                            kind={boardKind}
                            onKindChange={setBoardKind}
                            onClose={closeStation}
                        />
                    ),
                    body: (
                        <StationSheetBody
                            station={station}
                            kind={boardKind}
                            onSelectTrain={openTrainFromList}
                        />
                    ),
                }
              : sheetMode === "planner"
                ? {
                      label: tJourney("title"),
                      detents: ["full"] as Detent[],
                      onDetentChange: () => {},
                      onDismiss: closePlanner,
                      header: <PlannerSheetHeader onClose={closePlanner} />,
                      body: (
                          <PlannerSheetBody
                              state={planner}
                              onChange={setPlanner}
                              onClose={closePlanner}
                              onSelectTrain={openTrainFromList}
                          />
                      ),
                  }
                : {
                      label: tHome("app_title"),
                      detents: ["peek", "full"] as Detent[],
                      onDetentChange: (d: Detent) => {
                          if (d === "full") setSearchOpen(true);
                          else cancelSearch();
                      },
                      onDismiss: undefined,
                      header: homeHeader,
                      body: searchOpen ? (
                          <SheetSearchBody
                              state={sheetSearch}
                              handlers={searchHandlers}
                          />
                      ) : null,
                  };
    const sheet =
        sheetMode === "disruptions"
            ? {
                  label: tDisruptions("title"),
                  detents: ["half", "full"] as Detent[],
                  onDetentChange: setDisruptionsDetent,
                  onDismiss: closeDisruptions,
                  header: (
                      <DisruptionsSheetHeader
                          count={disruptions.length}
                          onClose={closeDisruptions}
                      />
                  ),
                  body: (
                      <DisruptionsSheetBody
                          disruptions={disruptions}
                          follows={follows}
                      />
                  ),
              }
            : baseSheet;

    return (
        <main className="relative h-dvh w-screen overflow-hidden bg-map">
            <h1 className="sr-only">{tHome("app_title")}</h1>
            {/* Tab order follows the reading order: the search and the
                panels first, then the map and its controls, the credits
                last. The map comes last in the DOM; z-index keeps it below. */}
            {isDesktop && (
                <button
                    type="button"
                    onClick={() =>
                        document
                            .querySelector<HTMLInputElement>(
                                "main input[role='combobox']",
                            )
                            ?.focus()
                    }
                    className="sr-only z-50 cursor-pointer rounded-full bg-ink px-4 py-2 text-sm font-semibold text-surface focus:not-sr-only focus:absolute focus:top-4 focus:px-4 focus:py-2 focus:left-1/2 focus:-translate-x-1/2"
                >
                    {tShell("skip_to_search")}
                </button>
            )}

            <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+12px)] z-20 flex flex-col items-center gap-2">
                <StaleBanner
                    minutes={feed.kind === "stale" ? feed.minutes : null}
                />
                <Notice kind={notice} onDone={clearNotice} />
            </div>

            {isDesktop ? (
                <>
                    <AnimatePresence initial={false}>
                        {/* Search and settings stay reachable beside a panel */}
                        {desktopPanel !== "home" && (
                            <DockedPanel
                                key="search"
                                className="top-4"
                                style={{
                                    left: panelLeft,
                                    width: `min(360px, calc(100vw - ${panelLeft + 76}px))`,
                                }}
                            >
                                <div className="floating-card overflow-hidden rounded-sheet">
                                    <DesktopSearch
                                        trains={trains}
                                        handlers={searchHandlers}
                                        compact
                                        trailing={
                                            <>
                                                {desktopPanel !== "planner" && (
                                                    <PlannerButton
                                                        onClick={openPlanner}
                                                        onIntent={
                                                            prefetchPlanner
                                                        }
                                                        className="hidden size-9 bg-transparent hover:bg-surface-2 lg:flex"
                                                    />
                                                )}
                                                <SettingsButton
                                                    onClick={() =>
                                                        setSettingsOpen(true)
                                                    }
                                                    className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink hover:bg-surface-2"
                                                />
                                            </>
                                        }
                                    />
                                </div>
                            </DockedPanel>
                        )}
                        {desktopPanel === "home" && (
                            <DockedPanel key="home" className="top-4 left-4">
                                <div className="floating-card flex max-h-[calc(100dvh-104px)] w-[380px] flex-col overflow-y-auto rounded-sheet">
                                    <div className="flex items-center gap-2 px-4 pt-4 pb-3">
                                        <div className="min-w-0 flex-1">
                                            <Wordmark />
                                        </div>
                                        <PlannerButton
                                            onClick={openPlanner}
                                            onIntent={prefetchPlanner}
                                            className="size-9 bg-transparent hover:bg-surface-2"
                                        />
                                        <SettingsButton
                                            onClick={() =>
                                                setSettingsOpen(true)
                                            }
                                            className="flex size-9 cursor-pointer items-center justify-center rounded-full text-ink hover:bg-surface-2"
                                        />
                                    </div>
                                    <DesktopSearch
                                        trains={trains}
                                        handlers={searchHandlers}
                                        home={(focusSearch) => (
                                            <div className="px-2 pb-2 empty:hidden">
                                                <DisruptionChip
                                                    disruptions={disruptions}
                                                    follows={follows}
                                                    onClick={openDisruptions}
                                                    className="px-2 pb-2"
                                                />
                                                <CommuteList
                                                    rows={commute}
                                                    onOpenTrain={
                                                        openTrainFromList
                                                    }
                                                    onEdit={editFollow}
                                                    compact
                                                />
                                                {/* The same way in as on phones */}
                                                {follows.length === 0 &&
                                                    feed.kind === "ok" && (
                                                        <div className="flex flex-col px-2">
                                                            <FollowHint
                                                                onClick={
                                                                    focusSearch
                                                                }
                                                            />
                                                        </div>
                                                    )}
                                            </div>
                                        )}
                                    />
                                    {feed.kind !== "ok" &&
                                        feed.kind !== "stale" &&
                                        feed.kind !== "loading" && (
                                            <div className="border-t border-line p-4">
                                                <FeedMessage
                                                    state={feed}
                                                    onRetry={retry}
                                                />
                                            </div>
                                        )}
                                </div>
                            </DockedPanel>
                        )}
                        {desktopPanel === "train" && (
                            <DockedPanel
                                key="train"
                                className="top-4 bottom-4 left-4"
                            >
                                <TrainPanel
                                    view={trainView}
                                    fallback={fallback}
                                    onClose={closeTrain}
                                    onFollow={followTrain}
                                />
                            </DockedPanel>
                        )}
                        {desktopPanel === "station" && station && (
                            <DockedPanel
                                key="station"
                                className="top-4 bottom-4 left-4"
                            >
                                <StationPanel
                                    station={station}
                                    kind={boardKind}
                                    onKindChange={setBoardKind}
                                    onClose={closeStation}
                                    onSelectTrain={openTrainFromList}
                                    wide={isWide}
                                />
                            </DockedPanel>
                        )}
                        {desktopPanel === "planner" && (
                            <DockedPanel
                                key="planner"
                                className="top-4 bottom-4 left-4"
                            >
                                <JourneyPanel
                                    state={planner}
                                    onChange={setPlanner}
                                    onClose={closePlanner}
                                    onSelectTrain={openTrainFromList}
                                />
                            </DockedPanel>
                        )}
                        {desktopPanel === "disruptions" && (
                            <DockedPanel
                                key="disruptions"
                                className="top-4 bottom-4 left-4"
                            >
                                <DisruptionsPanel
                                    disruptions={disruptions}
                                    follows={follows}
                                    onClose={closeDisruptions}
                                />
                            </DockedPanel>
                        )}
                    </AnimatePresence>
                    <div
                        className={cn(
                            "absolute bottom-4 z-20 transition-[left] duration-(--mhav-duration-sheet) ease-sheet motion-reduce:transition-none",
                            desktopPanel !== "home" && "hidden lg:block",
                        )}
                        style={{ left: panelLeft || GUTTER }}
                    >
                        <Legend isDesktop />
                    </div>
                </>
            ) : (
                <>
                    <div
                        className={cn(
                            "absolute top-[calc(env(safe-area-inset-top)+12px)] right-4 z-20 transition-opacity duration-200",
                            sheetFull && "pointer-events-none opacity-0",
                        )}
                        aria-hidden={sheetFull || undefined}
                    >
                        <SettingsButton onClick={() => setSettingsOpen(true)} />
                    </div>
                    <div
                        className={cn(
                            "absolute bottom-[calc(var(--mhav-sheet-inset,0px)+2.25rem)] left-4 z-20 transition-[bottom,opacity] duration-(--mhav-duration-sheet) ease-sheet motion-reduce:transition-none",
                            (sheetMode !== "home" || searchOpen) &&
                                "pointer-events-none opacity-0",
                        )}
                    >
                        <Legend isDesktop={false} />
                    </div>
                </>
            )}
            <AnimatePresence>
                {!isDesktop && (
                    <BottomSheet
                        key="sheet"
                        contentKey={sheetMode}
                        label={sheet.label}
                        detents={sheet.detents}
                        detent={sheetDetent}
                        onDetentChange={sheet.onDetentChange}
                        onDismiss={sheet.onDismiss}
                        onPeekHeight={setPeekHeight}
                        fullTopGap={
                            sheetMode === "home" ? searchGap : FULL_TOP_GAP
                        }
                        bodyScroll={sheetMode !== "planner"}
                        modal={
                            sheetMode === "planner" ||
                            (sheetMode === "home" && searchOpen)
                        }
                        header={sheet.header}
                    >
                        {sheet.body}
                    </BottomSheet>
                )}
            </AnimatePresence>
            {/* Zoom only while a panel is open (D46) */}
            {isDesktop && desktopPanel === "home" && (
                <div className="absolute top-4 right-4 z-20">
                    <LayersButton />
                </div>
            )}
            <DynamicMap
                key={locale}
                trains={trains}
                selectedId={selectedId}
                followedIds={followedIds}
                onSelectTrain={(id) => selectTrain(id)}
                train={trainView?.vehicle}
                station={showStation ? station : null}
                flyTarget={flyTarget}
                insets={insets}
                isDesktop={isDesktop}
                panelOpen={desktopPanel !== "home"}
            />
            <KeepTrainVisible
                selectedId={selectedId}
                trains={trains}
                insets={insets}
            />
            {followUsed && (
                <FollowEditor
                    target={followTarget}
                    onClose={() => setFollowTarget(null)}
                    isDesktop={isDesktop}
                />
            )}
            {settingsUsed && (
                <SettingsDialog
                    open={settingsOpen}
                    onOpenChange={setSettingsOpen}
                    isDesktop={isDesktop}
                />
            )}
        </main>
    );
}
