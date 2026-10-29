"use client";

import type {
    Station,
    TrainFeatureProperties,
} from "@megisholavonat/api-client";
import {
    getStationBoardOptions,
    getTrainsOptions,
} from "@megisholavonat/api-client/react-query";
import { POLL_INTERVAL_MS } from "@megisholavonat/core/constants";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
    DesktopSearch,
    MobileSearch,
    SearchTrigger,
} from "@/components/search/Search";
import { rememberStation } from "@/components/search/useSearch";
import { SettingsDialog } from "@/components/settings/Settings";
import { BottomSheet, type Detent } from "@/components/sheet/BottomSheet";
import {
    type BoardKind,
    StationPanel,
    StationSheet,
} from "@/components/station/StationBoard";
import { TrainPanel } from "@/components/train/TrainPanel";
import { TrainSheet } from "@/components/train/TrainSheet";
import { useTrainView } from "@/components/train/useTrainView";
import { type Follow, useFollows } from "@/hooks/useFollows";
import { useIsDesktop } from "@/hooks/useIsMobile";
import type { FlyTarget } from "./MapComponent";

const DynamicMap = dynamic(() => import("./MapComponent"), {
    ssr: false,
    loading: () => <div className="h-full w-full bg-map" />,
});

const TRAIN_PANEL_WIDTH = 400 + 32;
const STATION_PANEL_WIDTH = 560 + 32;
const PEEK_INSET = 120;
const HALF_SHARE = 0.55;

function readParam(name: string): string | null {
    return new URLSearchParams(window.location.search).get(name);
}

export default function MapPage() {
    const locale = useLocale();
    const tHome = useTranslations("Home");
    const isDesktop = useIsDesktop();

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
    const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null);
    const [followTarget, setFollowTarget] = useState<FollowTarget | null>(null);
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

    const { view: trainView, isError: trainGone } = useTrainView(selectedId);
    const fallback = useMemo(
        (): TrainFeatureProperties | null =>
            trains?.features.find((f) => f.properties.vehicleId === selectedId)
                ?.properties ?? null,
        [trains, selectedId],
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

    const selectTrain = useCallback(
        (vehicleId: string | null, detent: Detent = "peek") => {
            setSelectedId(vehicleId);
            if (vehicleId) setTrainDetent(detent);
        },
        [],
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
                setSearchOpen(false);
                openStation(s);
            },
            onSelectTrain: (train: TrainFeatureProperties) => {
                setSearchOpen(false);
                openTrainFromList(train.vehicleId);
            },
        }),
        [openStation, openTrainFromList],
    );

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

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (
                e.key !== "Escape" ||
                settingsOpen ||
                searchOpen ||
                followTarget
            ) {
                return;
            }
            if (selectedId) closeTrain();
            else if (stationId) closeStation();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [
        selectedId,
        stationId,
        settingsOpen,
        searchOpen,
        followTarget,
        closeTrain,
        closeStation,
    ]);

    const insets = useMemo(() => {
        if (isDesktop) {
            return {
                bottom: 0,
                left: selectedId
                    ? TRAIN_PANEL_WIDTH
                    : stationId
                      ? STATION_PANEL_WIDTH
                      : 0,
            };
        }
        const half =
            typeof window === "undefined"
                ? 400
                : window.innerHeight * HALF_SHARE;
        const detent = selectedId
            ? trainDetent
            : stationId
              ? stationDetent
              : "peek";
        return { bottom: detent === "peek" ? PEEK_INSET : half, left: 0 };
    }, [isDesktop, selectedId, stationId, trainDetent, stationDetent]);

    const retry = () => {
        void trainsQuery.refetch();
    };

    const showTrain = !!selectedId;
    const showStation = !showTrain && !!stationId && !!station;
    const panelOpen = isDesktop && (showTrain || showStation);
    const sheetFull =
        (showTrain && trainDetent === "full") ||
        (showStation && stationDetent === "full");

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

            {feed.kind === "stale" && (
                <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+12px)] z-20 flex justify-center">
                    <StaleBanner minutes={feed.minutes} />
                </div>
            )}

            {isDesktop ? (
                <>
                    <div className="absolute top-4 right-4 z-20">
                        <LayersButton />
                    </div>
                    {!panelOpen && (
                        <>
                            <div className="floating-card absolute top-4 left-4 z-30 flex w-[380px] flex-col overflow-hidden rounded-sheet">
                                <div className="flex items-center gap-2 px-4 pt-4 pb-3">
                                    <div className="min-w-0 flex-1">
                                        <Wordmark />
                                    </div>
                                    <SettingsButton
                                        onClick={() => setSettingsOpen(true)}
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
                                                onOpenTrain={openTrainFromList}
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
                            <div className="absolute bottom-4 left-4 z-20">
                                <Legend isDesktop />
                            </div>
                        </>
                    )}
                    {showTrain && (
                        <TrainPanel
                            view={trainView}
                            fallback={fallback}
                            onClose={closeTrain}
                            onFollow={followTrain}
                        />
                    )}
                    {showStation && station && (
                        <StationPanel
                            station={station}
                            kind={boardKind}
                            onKindChange={setBoardKind}
                            onClose={closeStation}
                            onSelectTrain={openTrainFromList}
                        />
                    )}
                </>
            ) : (
                <>
                    {!sheetFull && (
                        <div className="absolute top-[calc(env(safe-area-inset-top)+12px)] right-4 z-20">
                            <SettingsButton
                                onClick={() => setSettingsOpen(true)}
                            />
                        </div>
                    )}
                    {!showTrain && !showStation && (
                        <div className="absolute bottom-[calc(var(--mhav-sheet-inset,0px)+2.25rem)] left-4 z-20 transition-[bottom] duration-300 ease-sheet">
                            <Legend isDesktop={false} />
                        </div>
                    )}
                    {showTrain ? (
                        <TrainSheet
                            view={trainView}
                            fallback={fallback}
                            detent={trainDetent}
                            onDetentChange={setTrainDetent}
                            onClose={closeTrain}
                            onFollow={followTrain}
                        />
                    ) : showStation && station ? (
                        <StationSheet
                            station={station}
                            kind={boardKind}
                            onKindChange={setBoardKind}
                            detent={stationDetent}
                            onDetentChange={setStationDetent}
                            onClose={closeStation}
                            onSelectTrain={openTrainFromList}
                        />
                    ) : (
                        <BottomSheet
                            label={tHome("app_title")}
                            detents={["peek"]}
                            detent="peek"
                            onDetentChange={() => {}}
                            header={
                                <div className="flex flex-col gap-4 px-4 pb-[max(env(safe-area-inset-bottom),16px)]">
                                    <SearchTrigger
                                        onClick={() => setSearchOpen(true)}
                                    />
                                    {follows.length > 0 ? (
                                        <CommuteList
                                            rows={commute}
                                            onOpenTrain={openTrainFromList}
                                            onEdit={editFollow}
                                        />
                                    ) : (
                                        feed.kind === "ok" && (
                                            <FollowHint
                                                onClick={() =>
                                                    setSearchOpen(true)
                                                }
                                            />
                                        )
                                    )}
                                    <FeedMessage state={feed} onRetry={retry} />
                                </div>
                            }
                        />
                    )}
                    {searchOpen && (
                        <MobileSearch
                            trains={trains}
                            handlers={searchHandlers}
                            onClose={() => setSearchOpen(false)}
                        />
                    )}
                </>
            )}
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
