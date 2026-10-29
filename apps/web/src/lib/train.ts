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
import {
    secondsIntoServiceDay,
    serviceDayStart,
} from "@megisholavonat/core/time";
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
}

type StopTimeWithPrediction = StopTimeWithCounty & {
    /** Per-stop delay forecast (minutes), added to the API in PR #93 */
    predictedDelay?: number | null;
};

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
): StopTiming {
    const useDeparture = index === 0;
    const scheduled = useDeparture
        ? stoptime.scheduledDeparture
        : stoptime.scheduledArrival;
    const realtime = useDeparture
        ? stoptime.realtimeDeparture
        : stoptime.realtimeArrival;
    const predicted = (stoptime as StopTimeWithPrediction).predictedDelay;

    let expected = realtime ?? scheduled;
    let estimated = false;
    if (!passed) {
        if (predicted != null) {
            expected = scheduled + Math.round(predicted) * 60;
            estimated = true;
        } else if (realtime == null || realtime === scheduled) {
            expected = scheduled + Math.max(0, currentDelay) * 60;
            estimated = currentDelay > 0;
        }
    }
    return {
        scheduled,
        expected,
        delay: Math.round((expected - scheduled) / 60),
        estimated,
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

/** Unix seconds of a time given in seconds into the trip's service day. */
export function toEpoch(serviceDate: string, seconds: number): number {
    return Math.floor(serviceDayStart(serviceDate) / 1000) + seconds;
}

export interface TrainReason {
    code: DelayReasonCode | null;
    /** Full alert text for the detailed view */
    text: string;
}

/** The train's delay reason: a known code when there is one, or the raw text. */
export function trainReason(alerts: Alert[] | undefined): TrainReason | null {
    if (!alerts || alerts.length === 0) return null;
    for (const alert of alerts) {
        const code =
            (alert.reason?.code as DelayReasonCode | undefined) ??
            delayReasonCode(alert.alertDescriptionText);
        if (code) return { code, text: alert.alertDescriptionText };
    }
    const first = alerts[0];
    return first ? { code: null, text: first.alertDescriptionText } : null;
}

/** Plain-words "usually late" level, or null if the train is usually fine. */
export function usuallyLate(
    station: TrainRouteStation | undefined,
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
