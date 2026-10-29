import type {
    TrainRouteStation,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";
import {
    getTrainDetailsOptions,
    getTrainHistoryOptions,
} from "@megisholavonat/api-client/react-query";
import { ticketUrl } from "@megisholavonat/core/ticket";
import { isStale } from "@megisholavonat/core/vehicle";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
    beforeDeparture,
    nextStopIndex,
    type StopTiming,
    stationIdOf,
    stopTiming,
    type TrainReason,
    toEpoch,
    trainNumber,
    trainReason,
    usuallyLate,
} from "@/lib/train";

export interface StopView {
    index: number;
    name: string;
    county: string | null;
    stationId: string | null;
    timing: StopTiming;
    passed: boolean;
    isNext: boolean;
    isLast: boolean;
    platform: string | null;
    /** The platform is a history-based guess */
    platformPredicted: boolean;
}

export interface TrainView {
    vehicle: VehiclePositionWithDelay;
    stale: boolean;
    stops: StopView[];
    next: StopView | null;
    reason: TrainReason | null;
    /** Only before departure, in plain words */
    usuallyLate: "late" | "veryLate" | null;
    /** On-time share at the next stop, with enough history */
    punctuality: { station: string; onTimeOf10: number } | null;
    ticketUrl: string;
}

const HOUR = 60 * 60 * 1000;

export function useTrainDetails(vehicleId: string | null) {
    return useQuery({
        ...getTrainDetailsOptions({ path: { vehicle_id: vehicleId ?? "" } }),
        enabled: !!vehicleId,
        refetchInterval: vehicleId ? 5000 : false,
        retry: 1,
    });
}

export function useTrainView(vehicleId: string | null): {
    view: TrainView | null;
    isError: boolean;
} {
    const details = useTrainDetails(vehicleId);
    const vehicle = details.data;
    const number = vehicle ? trainNumber(vehicle.trip.tripShortName) : "";

    const history = useQuery({
        ...getTrainHistoryOptions({ path: { trainNumber: number } }),
        enabled: !!number,
        staleTime: HOUR,
        retry: false,
    });

    const view = useMemo((): TrainView | null => {
        if (!vehicle) return null;
        const byStation = new Map<string, TrainRouteStation>();
        for (const station of history.data?.stations ?? []) {
            byStation.set(station.stationId, station);
        }
        const predictedByIndex = new Map<number, number | null | undefined>();
        vehicle.processedStops?.forEach((stop, i) => {
            predictedByIndex.set(stop.index ?? i, stop.predictedDelay);
        });
        const nextIdx = nextStopIndex(vehicle);
        const stoptimes = vehicle.trip.stoptimes;
        const stops = stoptimes.map((stoptime, index): StopView => {
            const passed = index < nextIdx;
            const stationId = stationIdOf(stoptime.stop);
            const known = stationId ? byStation.get(stationId) : undefined;
            const announced = stoptime.stop.platformCode ?? null;
            const guess =
                !announced && known?.typicalPlatform && !known.insufficientData
                    ? known.typicalPlatform
                    : null;
            return {
                index,
                name: stoptime.stop.name,
                county: stoptime.stop.county ?? null,
                stationId,
                timing: stopTiming(
                    stoptime,
                    index,
                    passed,
                    vehicle.delay,
                    predictedByIndex.get(index),
                ),
                passed,
                isNext: index === nextIdx,
                isLast: index === stoptimes.length - 1,
                platform: announced ?? guess,
                platformPredicted: !announced && !!guess,
            };
        });
        const next = stops[nextIdx] ?? null;
        const waiting = beforeDeparture(vehicle);
        const firstStation = stops[0]?.stationId
            ? byStation.get(stops[0].stationId)
            : undefined;
        const nextStation = next?.stationId
            ? byStation.get(next.stationId)
            : undefined;
        const share = nextStation?.onTimeShare;
        const last = stoptimes[stoptimes.length - 1];
        const from = next ? stoptimes[next.index] : undefined;
        return {
            vehicle,
            stale: isStale(vehicle),
            stops,
            next,
            reason: trainReason(vehicle.trip.alerts),
            usuallyLate: waiting ? usuallyLate(firstStation) : null,
            punctuality:
                nextStation &&
                share != null &&
                !nextStation.insufficientData &&
                next
                    ? {
                          station: next.name,
                          onTimeOf10: Math.round(share * 10),
                      }
                    : null,
            ticketUrl: ticketUrl(
                from ? stationIdOf(from.stop) : null,
                last && from !== last ? stationIdOf(last.stop) : null,
                from
                    ? toEpoch(vehicle.trip.serviceDate, from.scheduledDeparture)
                    : null,
            ),
        };
    }, [vehicle, history.data]);

    return { view, isError: details.isError };
}
