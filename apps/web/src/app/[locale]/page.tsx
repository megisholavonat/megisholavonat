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
import {
    FollowEditor,
    type FollowTarget,
} from "@/components/commute/FollowEditor";
import {
    followedVehicleIds,
    useCommute,
} from "@/components/commute/useCommute";
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
    JourneyPanel,
    PlannerButton,
    PlannerSheetBody,
    PlannerSheetHeader,
    usePlannerState,
} from "@/components/journey/JourneyPlanner";
import {
    DesktopSearch,
    SheetSearchBody,
    SheetSearchHeader,
    useSearchState,
} from "@/components/search/Search";
import { rememberStation } from "@/components/search/useSearch";
import { SettingsDialog } from "@/components/settings/Settings";
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
import { type Follow, useFollows } from "@/hooks/useFollows";
import { useIsDesktop } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";
import type { FlyTarget, MapInsets } from "./MapComponent";

const DynamicMap = dynamic(() => import("./MapComponent"), {
    ssr: false,
    loading: () => <div className="h-full w-full bg-map" />,
});

/** Desktop panels: width plus the 16 px gutters either side */
const GUTTER = 16;
const TRAIN_PANEL = 400;
const STATION_PANEL_WIDE = 560;
const STATION_PANEL_NARROW = 400;
const PLANNER_PANEL = 440;
/** The open search sheet leaves this share of the screen to the map */
const SEARCH_MAP_SHARE = 0.18;

const WIDE_QUERY = "(min-width: 1024px)";

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
    const isDesktop = useIsDesktop();
    const isWide = useIsWide();
    const sheetViewport = useSheetViewport();

    const trainsQuery = useQuery({
        ...getTrainsOptions(),
        refetchInterval: POLL_INTERVAL_MS,
    });
    const trains = trainsQuery.data;
    const feed = feedState(trains, trainsQuery.isError, trainsQuery.isPending);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [stationId, setStationId] = useState<string | null>(null);
    const [pickedStation, setPickedStation] = useState<Station | null>(null);
    const [boardKind, setBoardKind] = useState<BoardKind>("departures");
    const [trainDetent, setTrainDetent] = useState<Detent>("peek");
    const [stationDetent, setStationDetent] = useState<Detent>("half");
    const [searchOpen, setSearchOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [plannerOpen, setPlannerOpen] = useState(false);
    const [planner, setPlanner] = usePlannerState();
    const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null);
    const [followTarget, setFollowTarget] = useState<FollowTarget | null>(null);
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

    // Restore the selection from the URL once
    useEffect(() => {
        const vehicleId = readParam("vehicleId");
        const station = readParam("station");
        if (vehicleId) {
            setSelectedId(vehicleId);
            pendingFlyRef.current = vehicleId;
        }
        if (station) setStationId(station);
        setUrlRead(true);
    }, []);

    // Mirror the selection in the URL (shareable; the consent prompt also
    // watches ?vehicleId to notice a closed panel)
    useEffect(() => {
        if (!urlRead) return;
        const params = new URLSearchParams(window.location.search);
        for (const [key, value] of [
            ["vehicleId", selectedId],
            ["station", stationId],
        ] as const) {
            if (value) params.set(key, value);
            else params.delete(key);
        }
        const search = params.toString();
        window.history.replaceState(
            null,
            "",
            `${window.location.pathname}${search ? `?${search}` : ""}`,
        );
    }, [selectedId, stationId, urlRead]);

    const board = useQuery({
        ...getStationBoardOptions({
            path: { stationId: stationId ?? "" },
            query: { kind: boardKind, limit: 30 },
        }),
        enabled: !!stationId,
    });
    const station = useMemo((): Station | null => {
        if (!stationId) return null;
        if (pickedStation?.id === stationId) return pickedStation;
        return board.data?.station ?? null;
    }, [stationId, pickedStation, board.data]);

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
        if (!flyToTrain(pending)) setSelectedId(null);
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
                closeSearch();
                openStation(s);
            },
            onSelectTrain: (train: TrainFeatureProperties) => {
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

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || settingsOpen || followTarget) return;
            if (searchOpen) {
                sheetSearch.setQuery("");
                closeSearch();
            } else if (selectedId) closeTrain();
            else if (stationId) closeStation();
            else if (plannerOpen) closePlanner();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [
        selectedId,
        stationId,
        settingsOpen,
        searchOpen,
        followTarget,
        plannerOpen,
        closeTrain,
        closeStation,
        closePlanner,
        closeSearch,
        sheetSearch.setQuery,
    ]);

    const showTrain = !!selectedId;
    const showStation = !showTrain && !!stationId && !!station;
    const showPlanner = !showTrain && !showStation && plannerOpen;
    const desktopPanel = showTrain
        ? "train"
        : showStation
          ? "station"
          : showPlanner
            ? "planner"
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
                : 0;
    /** Map left of this is under the side panel */
    const panelLeft = panelWidth ? panelWidth + 2 * GUTTER : 0;

    const sheetMode = desktopPanel;
    const sheetDetent: Detent =
        sheetMode === "train"
            ? trainDetent
            : sheetMode === "station"
              ? stationDetent
              : sheetMode === "planner" || searchOpen
                ? "full"
                : "peek";
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
                trailing={<PlannerButton onClick={openPlanner} />}
            />
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

    const sheet =
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

    return (
        <main className="relative h-dvh w-screen overflow-hidden bg-map">
            <h1 className="sr-only">{tHome("app_title")}</h1>
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
            />
            <KeepTrainVisible
                selectedId={selectedId}
                trains={trains}
                insets={insets}
            />

            <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+12px)] z-20 flex justify-center">
                <StaleBanner
                    minutes={feed.kind === "stale" ? feed.minutes : null}
                />
            </div>

            {isDesktop ? (
                <>
                    <div className="absolute top-4 right-4 z-20">
                        <LayersButton />
                    </div>
                    <AnimatePresence initial={false}>
                        {desktopPanel === "home" && (
                            <DockedPanel key="home" className="top-4 left-4">
                                <div className="floating-card flex max-h-[calc(100dvh-104px)] w-[380px] flex-col overflow-y-auto rounded-sheet">
                                    <div className="flex items-center gap-2 px-4 pt-4 pb-3">
                                        <div className="min-w-0 flex-1">
                                            <Wordmark />
                                        </div>
                                        <PlannerButton
                                            onClick={openPlanner}
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
                                        home={
                                            <div className="px-2 pb-2 empty:hidden">
                                                <CommuteList
                                                    rows={commute}
                                                    onOpenTrain={
                                                        openTrainFromList
                                                    }
                                                    onEdit={editFollow}
                                                    compact
                                                />
                                            </div>
                                        }
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
            <FollowEditor
                target={followTarget}
                onClose={() => setFollowTarget(null)}
                isDesktop={isDesktop}
            />
            <SettingsDialog
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                isDesktop={isDesktop}
            />
        </main>
    );
}
