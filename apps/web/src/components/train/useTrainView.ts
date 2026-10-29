import type {
    InfoService,
    TrainFeatureProperties,
    TrainRouteStation,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";
import {
    getTrainDetailsOptions,
    getTrainHistoryOptions,
} from "@megisholavonat/api-client/react-query";
import { type TrainDisplay, trainDisplay } from "@megisholavonat/core/display";
import { decodePolyline } from "@megisholavonat/core/polyline";
import { ticketUrl } from "@megisholavonat/core/ticket";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useNow } from "@/hooks/useNow";
import {
    beforeDeparture,
    nextStopIndex,
    polylineKm,
    type StopTiming,
    stationIdOf,
    stopTiming,
    type TrainPosition,
    type TrainReason,
    toEpoch,
    trainNumber,
    trainPosition,
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
    /** Services valid here but not for the whole trip (bike carriage A→B) */
    services: InfoService[];
}

export interface TrainView {
    vehicle: VehiclePositionWithDelay;
    /** The delay and state shown, the same as the map marker's */
    display: TrainDisplay;
    /** No live delay: stale, idle or cancelled */
    stale: boolean;
    stops: StopView[];
    next: StopView | null;
    reason: TrainReason | null;
    /** Only before departure, in plain words */
    usuallyLate: "late" | "veryLate" | null;
    /** On-time share at the next stop, with enough history */
    punctuality: { station: string; onTimeOf10: number } | null;
    ticketUrl: string;
    /** Where the train is between its last and next stop */
    position: TrainPosition;
    /** Whole-trip services */
    services: InfoService[];
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

export function useTrainView(
    vehicleId: string | null,
    /** The train's list entry, for details cached without `activity` */
    listed: TrainFeatureProperties | null = null,
): {
    view: TrainView | null;
    isError: boolean;
} {
    const details = useTrainDetails(vehicleId);
    const vehicle = details.data;
    const now = useNow();
    const number = vehicle ? trainNumber(vehicle.trip.tripShortName) : "";

    const history = useQuery({
        ...getTrainHistoryOptions({ path: { trainNumber: number } }),
        enabled: !!number,
        staleTime: HOUR,
        retry: false,
    });

    // Route length, to turn distances along the route into km
    const points = vehicle?.trip.tripGeometry.points;
    const routeKm = useMemo(
        () => (points ? polylineKm(decodePolyline(points)) : null),
        [points],
    );

    const view = useMemo((): TrainView | null => {
        if (!vehicle) return null;
        // Details without `activity` borrow the list's flag, as the map does
        const flag =
            vehicle.activity == null &&
            listed?.vehicleId === vehicle.vehicleId &&
            listed.lastUpdated === vehicle.lastUpdated
                ? listed.isStale
                : undefined;
        const display = trainDisplay(
            { ...vehicle, isStale: flag },
            new Date(now),
        );
        // Idle and cancelled trains have no delay to carry forward or forecast
        const live = display.delay != null;
        const byStation = new Map<string, TrainRouteStation>();
        for (const station of history.data?.stations ?? []) {
            byStation.set(station.stationId, station);
        }
        const predictedByIndex = new Map<number, number | null | undefined>();
        vehicle.processedStops?.forEach((stop, i) => {
            if (live) {
                predictedByIndex.set(stop.index ?? i, stop.predictedDelay);
            }
        });
        const nextIdx = nextStopIndex(vehicle);
        const stoptimes = vehicle.trip.stoptimes;
        const lastIdx = stoptimes.length - 1;
        const displayable = vehicle.trip.infoServices.filter(
            (s) => s.displayable !== false,
        );
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
                    display.delay ?? 0,
                    predictedByIndex.get(index),
                    index === lastIdx,
                ),
                passed,
                isNext: index === nextIdx,
                isLast: index === stoptimes.length - 1,
                platform: announced ?? guess,
                platformPredicted: !announced && !!guess,
                // A service shows where it begins; the trip row holds the
                // ones from the first stop. Each explains its range on tap.
                services:
                    index > 0
                        ? displayable.filter((s) => s.fromStopIndex === index)
                        : [],
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
            display,
            stale: display.state !== "running",
            stops,
            next,
            reason: trainReason(vehicle.trip.alerts, Date.now() / 1000),
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
            position: trainPosition(vehicle, nextIdx, routeKm),
            services: displayable.filter((s) => s.fromStopIndex <= 0),
        };
    }, [vehicle, history.data, now, listed, routeKm]);

    return { view, isError: details.isError };
}

/**
 * The delay a train sheet shows: from the details once loaded, else from the
 * list feature, both through trainDisplay like the map marker.
 */
export function useShownDelay(
    view: TrainView | null,
    fallback: TrainFeatureProperties | null,
): { delay: number | null; stale: boolean } {
    const now = useNow();
    const display =
        view?.display ??
        (fallback ? trainDisplay(fallback, new Date(now)) : null);
    if (!display) return { delay: null, stale: true };
    return { delay: display.delay, stale: display.state !== "running" };
}
