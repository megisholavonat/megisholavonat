import type {
    Alert,
    StopTimeWithCounty,
    StopWithCounty,
    TrainRouteStation,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";
import { type DelayLevel, getDelayLevel } from "@megisholavonat/core/delay";
import {
    type DelayReasonCode,
    delayReasonCode,
} from "@megisholavonat/core/delayReasons";
import { tripRun } from "@megisholavonat/core/commute";
import { secondsIntoServiceDay } from "@megisholavonat/core/time";
import { DISPLAY_RULES } from "@megisholavonat/core/tokens";

/** "10 TRANSCARPATHIA gyorsvonat" -> "10"; the key of the history endpoints. */
export function trainNumber(tripShortName: string): string {
    return tripShortName.trim().split(/\s+/, 1)[0] ?? tripShortName;
}

/**
 * The train's name without its category: "10 TRANSCARPATHIA gyorsvonat" ->
 * "TRANSCARPATHIA", "2010 személyvonat" -> null. Names are the upper-case run.
 */
export function trainName(tripShortName: string): string | null {
    const words = tripShortName.trim().split(/\s+/).slice(1);
    const named = words.filter(
        (w) => w.length > 1 && w === w.toLocaleUpperCase("hu"),
    );
    return named.length > 0 ? named.join(" ") : null;
}

/** UIC station code of a stop, as the history and board endpoints use. */
export function stationIdOf(stop: StopWithCounty): string | null {
    if (stop.stationUicPricingCode) return stop.stationUicPricingCode;
    if (!stop.gtfsId) return null;
    return stop.gtfsId.split(":").pop()?.split("_")[0] ?? null;
}

/** Name of the train's last stop. */
export function destinationOf(vehicle: VehiclePositionWithDelay): string {
    const stops = vehicle.trip.stoptimes;
    return stops[stops.length - 1]?.stop.name ?? "";
}

export interface StopTiming {
    /** Scheduled time, seconds into the service day */
    scheduled: number;
    /** Expected / actual time, seconds into the service day */
    expected: number;
    /** Minutes late at this stop */
    delay: number;
    /** Our estimate rather than a published realtime time: shown with "≈" */
    estimated: boolean;
    /**
     * Departure from an intermediate stop when it differs from the arrival
     * (the train waits there); null at both ends and for short stops.
     */
    departure: { scheduled: number; expected: number } | null;
}

/**
 * Arrival (or departure at the first stop) of a stop. Passed stops use the
 * published realtime time. Stops ahead prefer the per-stop forecast, then a
 * published realtime time that differs from the timetable, and otherwise
 * carry the train's current (GPS based) delay forward as an estimate.
 */
export function stopTiming(
    stoptime: StopTimeWithCounty,
    index: number,
    passed: boolean,
    currentDelay: number,
    /** Per-stop delay forecast (minutes) from the API, when it has one */
    predicted?: number | null,
    isLast = false,
): StopTiming {
    const expectedOf = (
        scheduled: number,
        realtime: number | null | undefined,
    ): { expected: number; estimated: boolean } => {
        if (passed)
            return { expected: realtime ?? scheduled, estimated: false };
        if (predicted != null) {
            return {
                expected: scheduled + Math.round(predicted) * 60,
                estimated: true,
            };
        }
        if (realtime == null || realtime === scheduled) {
            return {
                expected: scheduled + Math.max(0, currentDelay) * 60,
                estimated: currentDelay > 0,
            };
        }
        return { expected: realtime, estimated: false };
    };
    const useDeparture = index === 0;
    const scheduled = useDeparture
        ? stoptime.scheduledDeparture
        : stoptime.scheduledArrival;
    const { expected, estimated } = expectedOf(
        scheduled,
        useDeparture ? stoptime.realtimeDeparture : stoptime.realtimeArrival,
    );

    let departure: StopTiming["departure"] = null;
    if (!useDeparture && !isLast) {
        const dep = expectedOf(
            stoptime.scheduledDeparture,
            stoptime.realtimeDeparture,
        );
        // A train never leaves before it arrives
        const depExpected = Math.max(dep.expected, expected);
        if (
            stoptime.scheduledDeparture - scheduled >= 60 ||
            depExpected - expected >= 60
        ) {
            departure = {
                scheduled: stoptime.scheduledDeparture,
                expected: depExpected,
            };
        }
    }
    return {
        scheduled,
        expected,
        delay: Math.round((expected - scheduled) / 60),
        estimated,
        departure,
    };
}

/** Index of the first stop the train has not reached yet. */
export function nextStopIndex(vehicle: VehiclePositionWithDelay): number {
    const fromProgress = vehicle.vehicleProgress?.nextStopIndex;
    if (fromProgress != null) return fromProgress;
    const processed = vehicle.processedStops ?? [];
    const index = processed.findIndex(
        (stop) => stop.distanceAlongRoute > vehicle.trainPosition,
    );
    return index === -1
        ? Math.max(0, vehicle.trip.stoptimes.length - 1)
        : index;
}

/** Whether the train is still waiting to leave its first stop. */
export function beforeDeparture(
    vehicle: VehiclePositionWithDelay,
    now: Date = new Date(),
): boolean {
    const first = vehicle.trip.stoptimes[0];
    if (!first) return false;
    const departure = first.realtimeDeparture ?? first.scheduledDeparture;
    return secondsIntoServiceDay(vehicle.trip, now) < departure;
}

/**
 * The train's stops with the local date it leaves each on, resolved past
 * OTP's off-by-a-day service dates (HÉVs after midnight, train 10).
 */
export function runStops(
    vehicle: VehiclePositionWithDelay,
    now: Date = new Date(),
): { stationId: string | null; date: string }[] {
    return vehicle.trip.stoptimes.map((stoptime) => ({
        stationId: stationIdOf(stoptime.stop),
        date: tripRun(vehicle.trip, stoptime.scheduledDeparture, now).date,
    }));
}

export interface TrainAlert {
    /** Known delay reason, or null for a free-text notice */
    code: DelayReasonCode | null;
    /** MÁV's full text */
    text: string;
    url: string | null;
    /** Validity, Unix seconds */
    start: number;
    end: number;
}

export interface TrainReason {
    /** First known delay reason, for the compact chip */
    code: DelayReasonCode | null;
    /** Full alert text of that reason */
    text: string;
    /** Every alert of the trip, known reasons first */
    alerts: TrainAlert[];
}

/**
 * The train's alerts that are still in effect: the first known delay reason,
 * and the full list.
 */
export function trainReason(
    alerts: Alert[] | undefined,
    nowS: number,
): TrainReason | null {
    if (!alerts || alerts.length === 0) return null;
    const current = alerts.filter(
        (a) => !(a.effectiveEndDate > 0 && a.effectiveEndDate < nowS),
    );
    const all = current.map(
        (alert): TrainAlert => ({
            code:
                (alert.reason?.code as DelayReasonCode | undefined) ??
                delayReasonCode(alert.alertDescriptionText),
            text: alert.alertDescriptionText.trim(),
            url: alert.alertUrl || null,
            start: alert.effectiveStartDate,
            end: alert.effectiveEndDate,
        }),
    );
    all.sort((a, b) => Number(!a.code) - Number(!b.code));
    const first = all[0];
    return first ? { code: first.code, text: first.text, alerts: all } : null;
}

/** Where the train is between two stops of its stop list. */
export interface TrainPosition {
    /** Last stop passed (-1 before the first) */
    fromIndex: number;
    /** Stop it heads to */
    toIndex: number;
    /** 0…1 between the two, by distance along the route */
    fraction: number;
    /** Route length of the segment in km, when the geometry allows */
    segmentKm: number | null;
}

/** Length of a polyline in km. */
export function polylineKm(points: [number, number][]): number {
    let km = 0;
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        if (a && b) km += haversineKm(a[0], a[1], b[0], b[1]);
    }
    return km;
}

export function haversineKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
): number {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * The train's place between its last and next stop, from its projection on
 * the route (`trainPosition`) and the stops' distances along it.
 */
export function trainPosition(
    vehicle: VehiclePositionWithDelay,
    nextIndex: number,
    routeKm: number | null,
): TrainPosition {
    const stops = vehicle.processedStops ?? [];
    const distanceOf = (index: number) =>
        (stops.find((s) => s.index === index) ?? stops[index])
            ?.distanceAlongRoute;
    const fromIndex = nextIndex - 1;
    const from = distanceOf(fromIndex);
    const to = distanceOf(nextIndex);
    const kmPerUnit =
        routeKm && vehicle.totalRouteDistance > 0
            ? routeKm / vehicle.totalRouteDistance
            : null;
    if (from == null || to == null || to <= from) {
        return { fromIndex, toIndex: nextIndex, fraction: 0, segmentKm: null };
    }
    const fraction = Math.min(
        1,
        Math.max(0, (vehicle.trainPosition - from) / (to - from)),
    );
    return {
        fromIndex,
        toIndex: nextIndex,
        fraction,
        segmentKm: kmPerUnit ? (to - from) * kmPerUnit : null,
    };
}

/** Plain-words "usually late" level, or null if the train is usually fine. */
export function usuallyLate(
    station:
        | Pick<TrainRouteStation, "insufficientData" | "n" | "medianDelayMin">
        | undefined,
): "late" | "veryLate" | null {
    const rule = DISPLAY_RULES.usuallyLate;
    if (!station || station.insufficientData || station.n < rule.minRuns) {
        return null;
    }
    const median = station.medianDelayMin;
    if (median == null || median < rule.minTypicalDelayMinutes) return null;
    return getDelayLevel(median) === "moderate" ||
        getDelayLevel(median) === "severe"
        ? "veryLate"
        : "late";
}

/** A history-based platform guess: only with enough runs behind it. */
export function predictedPlatform(
    station: TrainRouteStation | undefined,
): string | null {
    if (!station?.typicalPlatform || station.insufficientData) return null;
    return station.typicalPlatform;
}

export function delayLevel(delay: number, stale = false): DelayLevel | "stale" {
    return stale ? "stale" : getDelayLevel(delay);
}
