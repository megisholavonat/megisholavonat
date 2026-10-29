import type {
    StopTimeWithCounty,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";
import { roundMinutes, secondsToMinutes } from "./delay";
import { secondsIntoServiceDay } from "./time";

// A train's stops: their ids, expected times and "≈" marks, the same in the
// web sheet and the app.

/**
 * UIC station code of a stop, as the history and board endpoints use: OTP's
 * `stationUicPricingCode`, else derived from the platform-level gtfsId
 * (`1:005501024_14` -> `005501024`) like the API's util/stop.py.
 */
export function stationIdOf(stop: {
    stationUicPricingCode?: string | null;
    gtfsId?: string | null;
}): string | null {
    if (stop.stationUicPricingCode) return stop.stationUicPricingCode;
    if (!stop.gtfsId) return null;
    const colon = stop.gtfsId.indexOf(":");
    const local = colon < 0 ? stop.gtfsId : stop.gtfsId.slice(colon + 1);
    return local.split("_", 1)[0] || null;
}

/** A time at a stop, seconds into the service day. */
export interface StopTime {
    scheduled: number;
    /** Expected / actual time */
    expected: number;
}

export interface StopTiming extends StopTime {
    /** Minutes late at this stop */
    delay: number;
    /** Our estimate rather than a published realtime time: shown with "≈" */
    estimated: boolean;
    /**
     * Departure from an intermediate stop when it differs from the arrival
     * (the train waits there); null at both ends and for short stops.
     */
    departure: StopTime | null;
    /**
     * When the train leaves the stop, short stop or not (the first stop's is
     * the timing itself); null at the last stop.
     */
    leaves: (StopTime & { estimated: boolean }) | null;
}

/** A wait at a stop shorter than this shows a single time. */
export const MIN_DWELL_S = 60;

/**
 * Arrival (or departure at the first stop) of a stop. Passed stops use the
 * published realtime time. Stops ahead prefer the per-stop forecast, then a
 * published realtime time that differs from the timetable, and otherwise
 * carry the train's current (GPS based) delay forward as an estimate.
 */
export function stopTiming(
    stoptime: Pick<
        StopTimeWithCounty,
        | "scheduledArrival"
        | "scheduledDeparture"
        | "realtimeArrival"
        | "realtimeDeparture"
    >,
    index: number,
    passed: boolean,
    /** The train's current delay in minutes */
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
                expected: scheduled + roundMinutes(predicted) * 60,
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
    let leaves: StopTiming["leaves"] = useDeparture
        ? { scheduled, expected, estimated }
        : null;
    if (!useDeparture && !isLast) {
        const dep = expectedOf(
            stoptime.scheduledDeparture,
            stoptime.realtimeDeparture,
        );
        // A train never leaves before it arrives
        const depExpected = Math.max(dep.expected, expected);
        leaves = {
            scheduled: stoptime.scheduledDeparture,
            expected: depExpected,
            estimated: depExpected === dep.expected ? dep.estimated : estimated,
        };
        if (
            stoptime.scheduledDeparture - scheduled >= MIN_DWELL_S ||
            depExpected - expected >= MIN_DWELL_S
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
        delay: secondsToMinutes(expected - scheduled),
        estimated,
        departure,
        leaves,
    };
}

/**
 * The API's per-stop delay forecasts (minutes) by stop index, from the
 * processed stops of a live train.
 */
export function predictedDelays(
    vehicle: Pick<VehiclePositionWithDelay, "processedStops">,
): Map<number, number | null | undefined> {
    const byIndex = new Map<number, number | null | undefined>();
    vehicle.processedStops?.forEach((stop, i) => {
        byIndex.set(stop.index ?? i, stop.predictedDelay);
    });
    return byIndex;
}

/** Whether the train is still waiting to leave its first stop. */
export function beforeDeparture(
    vehicle: Pick<VehiclePositionWithDelay, "trip">,
    now: Date = new Date(),
): boolean {
    const first = vehicle.trip.stoptimes[0];
    if (!first) return false;
    const departure = first.realtimeDeparture ?? first.scheduledDeparture;
    return secondsIntoServiceDay(vehicle.trip, now) < departure;
}

/** What deciding on "≈" needs of a stop */
export interface EstimateStop {
    index: number;
    passed: boolean;
    timing: { estimated: boolean };
}

/**
 * A stop's time is our estimate ("≈"): ahead and estimated, or ahead of a
 * train without live data. A departure from the first stop is the
 * timetable's (or MÁV's) time, and a passed stop's time is actual.
 */
export function isEstimate(stop: EstimateStop, stale: boolean): boolean {
    if (stop.passed) return false;
    return stop.timing.estimated || (stale && stop.index > 0);
}

/**
 * The arrival time shown for a stop. Standing there, the train has arrived:
 * the arrival is actual (no "≈"), and only the departure is still ahead.
 */
export function arrivalIsEstimate(
    stop: EstimateStop,
    stale: boolean,
    standingHere: boolean,
): boolean {
    if (standingHere && stop.index > 0) return false;
    return isEstimate(stop, stale);
}
