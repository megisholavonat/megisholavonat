import type {
    BoardEntry,
    StationBoard,
    StationPlatforms,
    TrainFeatureCollection,
} from "@megisholavonat/api-client";
import {
    getStationBoardOptions,
    getStationPlatformsOptions,
    getTrainStationHistoryOptions,
} from "@megisholavonat/api-client/react-query";
import {
    currentOccurrence,
    type Occurrence,
} from "@megisholavonat/core/commute";
import type { DelayReasonCode } from "@megisholavonat/core/delayReasons";
import { trainDisplay } from "@megisholavonat/core/display";
import { trainNumber } from "@megisholavonat/core/trainName";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { Follow } from "@/hooks/useFollows";
import { predictedPlatformsOf } from "@/hooks/usePredictedPlatforms";
import { usuallyLate } from "@/lib/train";

const HOUR_MS = 60 * 60 * 1000;
/** The board lists the next few hours at a busy station */
const BOARD_AHEAD_S = 4 * 3600;
const BOARD_LIMIT = 50;
/** A board entry this close to the followed time is the followed run */
const MATCH_WINDOW_S = 30 * 60;
/** A live train with the followed number counts from this long before */
const LIVE_BEFORE_S = 2 * 3600;
/** ... until this long after the scheduled departure */
const LIVE_AFTER_S = 3 * 3600;

export interface CommuteLive {
    vehicleId: string | null;
    /** Minutes late, when there is realtime data */
    delay: number | null;
    stale: boolean;
    canceled: boolean;
    reason: DelayReasonCode | null;
    departed: boolean;
}

export interface CommuteRow {
    follow: Follow;
    /** Null only for a single run that is over (dropped on next load) */
    occurrence: Occurrence | null;
    /** Live state of today's run */
    live: CommuteLive | null;
    platform: { value: string; predicted: boolean } | null;
    /** Plain-words "usually late", before departure only */
    usuallyLate: "late" | "veryLate" | null;
}

/** A clock that ticks every `ms`, for times that move on their own. */
export function useNow(ms = 30_000): Date {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), ms);
        return () => clearInterval(id);
    }, [ms]);
    return now;
}

function boardEntry(
    board: StationBoard | undefined,
    follow: Follow,
    departure: number,
): BoardEntry | null {
    for (const entry of board?.entries ?? []) {
        if (
            trainNumber(entry.tripShortName) === follow.trainNumber &&
            Math.abs(entry.scheduledTime - departure) <= MATCH_WINDOW_S
        ) {
            return entry;
        }
    }
    return null;
}

/** Whether a train with the followed number is on the rails right now. */
function isRunning(
    follow: Follow,
    trains: TrainFeatureCollection | undefined,
): boolean {
    return !!trains?.features.some(
        ({ properties: p }) =>
            trainNumber(p.tripShortName) === follow.trainNumber &&
            p.activity !== "arrived" &&
            p.activity !== "cancelled" &&
            p.activity !== "beforeDeparture",
    );
}

export function liveState(
    follow: Follow,
    occurrence: Occurrence,
    board: StationBoard | undefined,
    trains: TrainFeatureCollection | undefined,
    nowS: number,
    running: boolean,
): { live: CommuteLive | null; platform: string | null } {
    const entry = boardEntry(board, follow, occurrence.departure);
    // A run that left the boarding stop and is still out is the live one
    const near =
        (running && occurrence.departure <= nowS) ||
        (nowS > occurrence.departure - LIVE_BEFORE_S &&
            nowS < occurrence.departure + LIVE_AFTER_S);
    const vehicle =
        trains?.features.find((f) =>
            entry?.vehicleId
                ? f.properties.vehicleId === entry.vehicleId
                : near &&
                  trainNumber(f.properties.tripShortName) ===
                      follow.trainNumber,
        )?.properties ?? null;
    if (!entry && !vehicle) return { live: null, platform: null };
    const realtime = !!entry && (entry.realtime || entry.delaySource === "gps");
    const reason = entry?.reason?.code ?? vehicle?.reason?.code ?? null;
    // The same delay and state as the train's marker and sheet: none before
    // departure, after arrival, off its route or cancelled
    const shown = vehicle ? trainDisplay(vehicle, new Date(nowS * 1000)) : null;
    return {
        live: {
            vehicleId: vehicle?.vehicleId ?? entry?.vehicleId ?? null,
            delay: shown
                ? shown.delay
                : realtime && entry
                  ? entry.delayMinutes
                  : null,
            stale: shown?.state === "stale",
            canceled: !!entry?.canceled || shown?.state === "cancelled",
            reason: reason as DelayReasonCode | null,
            departed: !entry && nowS > occurrence.departure,
        },
        platform: entry?.platform ?? null,
    };
}

/**
 * The next run of every followed train, soonest first, with today's live
 * delay, platform and delay reason from the boarding station's board and the
 * live feed.
 */
export function useCommute(
    follows: Follow[],
    trains: TrainFeatureCollection | undefined,
): CommuteRow[] {
    const now = useNow();
    const nowS = now.getTime() / 1000;

    const running = useMemo(
        () => follows.map((follow) => isRunning(follow, trains)),
        [follows, trains],
    );
    const occurrences = useMemo(
        () =>
            follows.map((follow, i) =>
                currentOccurrence(follow, now, running[i]),
            ),
        [follows, now, running],
    );

    const stations = useMemo(
        () => [...new Set(follows.map((f) => f.fromStationId))].sort(),
        [follows],
    );
    // Boards only of stations with a run in the next few hours
    const boardStations = useMemo(() => {
        const ids = new Set<string>();
        follows.forEach((follow, i) => {
            const occ = occurrences[i];
            if (
                occ &&
                occ.departure - nowS < BOARD_AHEAD_S &&
                occ.departure > nowS - LIVE_AFTER_S
            ) {
                ids.add(follow.fromStationId);
            }
        });
        return [...ids].sort();
    }, [follows, occurrences, nowS]);

    const boards = useQueries({
        queries: boardStations.map((stationId) => ({
            ...getStationBoardOptions({
                path: { stationId },
                query: { kind: "departures", limit: BOARD_LIMIT },
            }),
            refetchInterval: 30_000,
        })),
    });
    const platforms = useQueries({
        queries: stations.map((stationId) => ({
            ...getStationPlatformsOptions({ path: { stationId } }),
            staleTime: HOUR_MS,
            retry: false,
        })),
    });
    const histories = useQueries({
        queries: follows.map((follow) => ({
            ...getTrainStationHistoryOptions({
                path: {
                    trainNumber: follow.trainNumber,
                    stationId: follow.fromStationId,
                },
            }),
            staleTime: HOUR_MS,
            retry: false,
        })),
    });

    const boardOf = new Map<string, StationBoard | undefined>();
    boardStations.forEach((id, i) => {
        boardOf.set(id, boards[i]?.data);
    });
    const platformsOf = new Map<string, StationPlatforms | undefined>();
    stations.forEach((id, i) => {
        platformsOf.set(id, platforms[i]?.data);
    });

    const rows = follows.map((follow, i): CommuteRow => {
        const occurrence = occurrences[i] ?? null;
        const history = histories[i]?.data;
        const guess =
            predictedPlatformsOf(platformsOf.get(follow.fromStationId)).get(
                follow.trainNumber,
            ) ?? null;
        const today =
            occurrence && occurrence.daysAhead <= 0
                ? liveState(
                      follow,
                      occurrence,
                      boardOf.get(follow.fromStationId),
                      trains,
                      nowS,
                      running[i] ?? false,
                  )
                : { live: null, platform: null };
        const { live } = today;
        const platform = today.platform
            ? { value: today.platform, predicted: false }
            : guess
              ? { value: guess, predicted: true }
              : null;
        const waiting = !live || (live.delay === null && !live.departed);
        return {
            follow,
            occurrence,
            live,
            platform: live?.departed ? null : platform,
            usuallyLate: waiting ? usuallyLate(history) : null,
        };
    });
    return rows.sort(
        (a, b) =>
            (a.occurrence?.departure ?? Number.POSITIVE_INFINITY) -
            (b.occurrence?.departure ?? Number.POSITIVE_INFINITY),
    );
}

/** Vehicle ids of followed trains on the map right now. */
export function followedVehicleIds(rows: CommuteRow[]): Set<string> {
    const ids = new Set<string>();
    for (const row of rows) {
        if (row.live?.vehicleId) ids.add(row.live.vehicleId);
    }
    return ids;
}
