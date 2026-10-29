import type {
    TrainFeatureCollection,
    TrainFeatureProperties,
} from "@megisholavonat/api-client";
import { trainDisplay } from "@megisholavonat/core/display";
import { useEffect, useRef } from "react";
import type { Detent } from "@/components/sheet/BottomSheet";
import type { TrainView } from "@/components/train/useTrainView";
import { analytics, track } from "@/lib/analytics";
import { noteEntry, takeEntry } from "@/lib/analyticsEvents";
import { trainNumber } from "@/lib/train";

type FeedKind =
    | "loading"
    | "unreachable"
    | "source_down"
    | "empty"
    | "stale"
    | "ok";

const FEED_ERRORS = {
    unreachable: "feed_unreachable",
    source_down: "feed_down",
    empty: "feed_empty",
    stale: "feed_stale",
} as const;

const DETENT_RANK: Record<Detent, number> = { peek: 0, half: 1, full: 2 };

interface MapState {
    trains: TrainFeatureCollection | undefined;
    feed: FeedKind;
    isDesktop: boolean;
    selectedId: string | null;
    fallback: TrainFeatureProperties | null;
    trainView: TrainView | null;
    followed: ReadonlySet<string>;
    trainDetent: Detent;
    stationId: string | null;
    stationLoaded: boolean;
    stationDetent: Detent;
    boardKind: "departures" | "arrivals";
    searchOpen: boolean;
    plannerOpen: boolean;
    disruptionsOpen: boolean;
    disruptionsDetent: Detent;
    disruptionCount: number;
    notice: "train_gone" | "station_unknown" | null;
}

/**
 * The map's product events, derived from its state: what opened, from
 * where, for how long, and which error states were shown. The entry point
 * of a train or station comes from {@link noteEntry} (search, board,
 * commute), else from what was open (planner, a board), else the map.
 */
export function useMapAnalytics(state: MapState) {
    const {
        trains,
        feed,
        isDesktop,
        selectedId,
        fallback,
        trainView,
        followed,
        trainDetent,
        stationId,
        stationLoaded,
        stationDetent,
        boardKind,
        searchOpen,
        plannerOpen,
        disruptionsOpen,
        disruptionsDetent,
        notice,
    } = state;
    const surface = isDesktop ? "panel" : "sheet";
    const latest = useRef(state);
    latest.current = state;

    // Time to the first trains on the map
    const ready = useRef(false);
    useEffect(() => {
        if (ready.current || !trains) return;
        ready.current = true;
        track("map_ready", {
            ms: performance.now(),
            trains: trains.features.length,
        });
    }, [trains]);

    // The first selection comes from the URL: a shared link or a reload
    const fromUrl = useRef<boolean | null>(null);
    useEffect(() => {
        if (fromUrl.current === null) {
            const params = new URLSearchParams(window.location.search);
            fromUrl.current = params.has("vehicleId") || params.has("station");
        }
        if (!fromUrl.current || (!selectedId && !stationId)) return;
        fromUrl.current = false;
        const navigation = performance.getEntriesByType("navigation")[0] as
            | PerformanceNavigationTiming
            | undefined;
        noteEntry(navigation?.type === "reload" ? "reload" : "share_link");
    }, [selectedId, stationId]);
    useEffect(() => {
        const onPop = () => noteEntry("other");
        window.addEventListener("popstate", onPop);
        return () => window.removeEventListener("popstate", onPop);
    }, []);

    // Error states, each once per change
    useEffect(() => {
        if (feed in FEED_ERRORS) {
            track("error_shown", {
                kind: FEED_ERRORS[feed as keyof typeof FEED_ERRORS],
            });
        }
    }, [feed]);
    useEffect(() => {
        if (notice) track("error_shown", { kind: notice });
    }, [notice]);

    // Train: opened once its delay is known, closed with the time spent
    const train = useRef<{
        id: string;
        at: number;
        sent: boolean;
        entry: ReturnType<typeof takeEntry>;
        maxDetent: Detent;
    } | null>(null);
    useEffect(() => {
        const current = train.current;
        if (current?.id === selectedId) return;
        if (current?.sent) {
            track("train_closed", {
                surface: latest.current.isDesktop ? "panel" : "sheet",
                dwell_s: (Date.now() - current.at) / 1000,
                max_detent: current.maxDetent,
            });
        }
        train.current = selectedId
            ? {
                  id: selectedId,
                  at: Date.now(),
                  sent: false,
                  entry: takeEntry(),
                  maxDetent: "peek",
              }
            : null;
    }, [selectedId]);
    useEffect(() => {
        const current = train.current;
        if (!current || current.sent) return;
        const source = trainView?.vehicle ?? fallback;
        if (!source && !trains) return;
        current.sent = true;
        const display =
            trainView?.display ?? (fallback && trainDisplay(fallback));
        const { plannerOpen, stationId } = latest.current;
        const tripShortName =
            trainView?.vehicle.trip.tripShortName ?? fallback?.tripShortName;
        track("train_opened", {
            entry:
                current.entry ??
                (plannerOpen ? "planner" : stationId ? "board" : "map"),
            surface,
            delay_level: display?.level ?? "unknown",
            state: display?.state ?? "unknown",
            followed: followed.has(current.id),
            train_number: tripShortName
                ? trainNumber(tripShortName)
                : undefined,
            route:
                trainView?.vehicle.trip.route.shortName ??
                fallback?.routeShortName ??
                undefined,
        });
    }, [trainView, fallback, trains, followed, surface]);

    // Detents (phones), the last one within a second
    useEffect(() => {
        const current = train.current;
        if (isDesktop || !current) return;
        if (DETENT_RANK[trainDetent] > DETENT_RANK[current.maxDetent]) {
            current.maxDetent = trainDetent;
        }
        if (current.sent) {
            analytics.trackDebounced(
                "sheet_detent_changed",
                { sheet: "train", detent: trainDetent },
                1000,
                "train",
            );
        }
    }, [trainDetent, isDesktop]);
    const stationShown = !selectedId && !!stationId && stationLoaded;
    useEffect(() => {
        if (isDesktop || !stationShown) return;
        analytics.trackDebounced(
            "sheet_detent_changed",
            { sheet: "station", detent: stationDetent },
            1000,
            "station",
        );
    }, [stationDetent, isDesktop, stationShown]);
    useEffect(() => {
        if (isDesktop || !disruptionsOpen) return;
        analytics.trackDebounced(
            "sheet_detent_changed",
            { sheet: "disruptions", detent: disruptionsDetent },
            1000,
            "disruptions",
        );
    }, [disruptionsDetent, isDesktop, disruptionsOpen]);

    // Station: once its board names it
    const station = useRef<string | null>(null);
    useEffect(() => {
        if (!stationId) station.current = null;
        if (!stationId || !stationLoaded || station.current === stationId) {
            return;
        }
        station.current = stationId;
        track("station_opened", {
            entry: takeEntry() ?? "map",
            surface,
            station_id: stationId,
        });
    }, [stationId, stationLoaded, surface]);
    const boardShown = useRef(boardKind);
    useEffect(() => {
        if (boardShown.current === boardKind) return;
        boardShown.current = boardKind;
        if (stationId) track("board_kind_changed", { board: boardKind });
    }, [boardKind, stationId]);

    // Layers above the map (the desktop search sends its own)
    useEffect(() => {
        if (searchOpen) track("search_opened", { surface: "sheet" });
    }, [searchOpen]);
    useEffect(() => {
        if (!plannerOpen) return;
        const { isDesktop } = latest.current;
        track("planner_opened", { surface: isDesktop ? "panel" : "sheet" });
    }, [plannerOpen]);
    useEffect(() => {
        if (!disruptionsOpen) return;
        const { isDesktop, disruptionCount } = latest.current;
        track("disruptions_opened", {
            surface: isDesktop ? "panel" : "sheet",
            count: disruptionCount,
        });
    }, [disruptionsOpen]);
}
