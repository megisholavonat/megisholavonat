import type {
    TrainFeatureCollection,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";
import { getTrainDetailsOptions } from "@megisholavonat/api-client/react-query";
import { stationIdOf } from "@megisholavonat/core/stops";
import { trainNumber } from "@megisholavonat/core/trainName";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { type StopRow, stopRows } from "../train/trainData";
import { isRunOf, type LocalFollow, type Run } from "./model";
import { rememberVehicle } from "./store";

const DETAILS_REFRESH_MS = 30_000;
/** Same train number running several times a day: check at most this many */
const MAX_CANDIDATES = 3;

export interface LiveFollow {
    vehicleId: string;
    details: VehiclePositionWithDelay;
    /** The boarding stop as the live data shows it */
    board: StopRow | null;
}

/** Vehicles on the map that could be running `follow`'s train. */
function candidates(
    follow: LocalFollow,
    trains: TrainFeatureCollection | undefined,
): string[] {
    const number = trainNumber(follow.tripShortName);
    const ids = (trains?.features ?? [])
        .filter((f) => trainNumber(f.properties.tripShortName) === number)
        .map((f) => f.properties.vehicleId);
    // The vehicle seen last time first
    ids.sort((a, b) =>
        a === follow.vehicleId ? -1 : b === follow.vehicleId ? 1 : 0,
    );
    return ids.slice(0, MAX_CANDIDATES);
}

/** The boarding stop's row: expected time, delay, platform, passed or not. */
export function boardingRow(
    follow: LocalFollow,
    details: VehiclePositionWithDelay,
): StopRow | null {
    const station = follow.stops[follow.from]?.stationId;
    const index = details.trip.stoptimes.findIndex(
        (st) => stationIdOf(st.stop) === station,
    );
    return index < 0 ? null : (stopRows(details)[index] ?? null);
}

/**
 * The live train of each follow running today, keyed by follow id. Trains
 * resolve once they are on the map (a little before they depart).
 */
export function useLiveFollows(
    items: readonly { follow: LocalFollow; run: Run }[],
    trains: TrainFeatureCollection | undefined,
): Map<string, LiveFollow> {
    const today = items.filter((i) => i.run.dayOffset <= 0);
    const perFollow = today.map((i) => candidates(i.follow, trains));
    const vehicleIds = [...new Set(perFollow.flat())];

    const results = useQueries({
        queries: vehicleIds.map((vehicleId) => ({
            ...getTrainDetailsOptions({ path: { vehicle_id: vehicleId } }),
            refetchInterval: DETAILS_REFRESH_MS,
        })),
    });
    const byVehicle = new Map(
        vehicleIds.map((id, i) => [id, results[i]?.data] as const),
    );

    const live = new Map<string, LiveFollow>();
    today.forEach(({ follow, run }, i) => {
        for (const vehicleId of perFollow[i] ?? []) {
            const details = byVehicle.get(vehicleId);
            if (details && isRunOf(follow, run.serviceDate, details)) {
                live.set(follow.id, {
                    vehicleId,
                    details,
                    board: boardingRow(follow, details),
                });
                break;
            }
        }
    });

    const seen = JSON.stringify([...live].map(([id, l]) => [id, l.vehicleId]));
    useEffect(() => {
        for (const [id, vehicleId] of JSON.parse(seen) as [string, string][]) {
            rememberVehicle(id, vehicleId);
        }
    }, [seen]);

    return live;
}

/** Vehicle ids of followed trains, for the map's star. */
export function useFollowedVehicleIds(live: Map<string, LiveFollow>) {
    const key = JSON.stringify(
        [...live.values()].map((l) => l.vehicleId).sort(),
    );
    return useMemo(() => JSON.parse(key) as string[], [key]);
}
