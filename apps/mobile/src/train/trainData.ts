import type {
    Alert,
    DelayReason,
    PlatformPrediction,
    StopTimeWithCounty,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";
import { secondsIntoServiceDay } from "@megisholavonat/core/time";
import { DISPLAY_RULES } from "@megisholavonat/core/tokens";
import { splitTripName } from "./labels";

// Pure helpers behind the train sheet. Unit tested under Node.

export type StopState = "passed" | "next" | "upcoming";

export interface StopRow {
    key: string;
    name: string;
    /** UIC station code, for history lookups and ticket links */
    uic: string | null;
    state: StopState;
    isFirst: boolean;
    isLast: boolean;
    /** Scheduled time, seconds since the start of the service day */
    scheduled: number;
    /** Actual (passed) or expected time on the same clock */
    expected: number;
    /** Delay at this stop in whole minutes */
    delay: number;
    /** A forecast beyond the next stop: shown as "≈17:44" */
    approximate: boolean;
    /** Announced platform */
    platform: string | null;
}

/** Optional per-stop forecast; not every API version sends it. */
function predictedDelay(stoptime: StopTimeWithCounty): number | null {
    const value = (stoptime as { predictedDelay?: unknown }).predictedDelay;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The stop list: passed stops with their actual times, then the next stop
 * and the rest with the live delay carried forward (or the per-stop
 * `predictedDelay` when the API sends one).
 */
export function stopRows(details: VehiclePositionWithDelay): StopRow[] {
    const stoptimes = details.trip.stoptimes;
    const next = details.vehicleProgress.nextStopIndex ?? 0;
    const liveDelay = Math.max(0, Math.round(details.delay));

    return stoptimes.map((st, index) => {
        const isFirst = index === 0;
        const isLast = index === stoptimes.length - 1;
        const state: StopState =
            index < next ? "passed" : index === next ? "next" : "upcoming";
        // Passed stops show when the train left, the others when it arrives
        // (the first stop has only a departure, the last only an arrival)
        const useDeparture = isFirst || (state === "passed" && !isLast);
        const scheduled = useDeparture
            ? st.scheduledDeparture
            : st.scheduledArrival;
        let expected: number;
        let delay: number;
        if (state === "passed") {
            expected = useDeparture ? st.realtimeDeparture : st.realtimeArrival;
            delay = Math.round((expected - scheduled) / 60);
        } else {
            delay = Math.max(0, Math.round(predictedDelay(st) ?? liveDelay));
            expected = scheduled + delay * 60;
        }
        return {
            key: `${index}-${st.stop.gtfsId ?? st.stop.name}`,
            name: st.stop.name,
            uic: st.stop.stationUicPricingCode ?? null,
            state,
            isFirst,
            isLast,
            scheduled,
            expected,
            delay,
            approximate: state === "upcoming",
            platform: st.stop.platformCode ?? null,
        };
    });
}

/**
 * "10 TRANSCARPATHIA" keeps a train's proper name; category words such as
 * "személyvonat" are dropped, like on the design boards.
 */
export function trainTitle(
    tripShortName: string,
    destination: string | null,
): { number: string; name: string | null; destination: string | null } {
    const split = splitTripName(tripShortName);
    const number = split.number ?? split.name;
    const rest = split.number ? split.name.trim() : "";
    const isProperName =
        rest.length > 0 && rest === rest.toLocaleUpperCase("hu-HU");
    return {
        number,
        name: isProperName ? rest : null,
        destination,
    };
}

/** The train hasn't left its first stop yet. */
export function beforeDeparture(
    details: VehiclePositionWithDelay,
    now: Date = new Date(),
): boolean {
    const first = details.trip.stoptimes[0];
    if (!first) return false;
    const departure = first.realtimeDeparture ?? first.scheduledDeparture;
    return secondsIntoServiceDay(details.trip, now) < departure;
}

interface DelayHistory {
    n: number;
    medianDelayMin?: number | null;
    insufficientData: boolean;
}

/** Typically ≥ 3 minutes late over ≥ 5 runs. Never shown as a number. */
export function isUsuallyLate(history: DelayHistory | undefined): boolean {
    const rule = DISPLAY_RULES.usuallyLate;
    return (
        !!history &&
        !history.insufficientData &&
        history.n >= rule.minRuns &&
        (history.medianDelayMin ?? 0) >= rule.minTypicalDelayMinutes
    );
}

/** Platform predicted with at least 80 % confidence, else null. */
export function predictedPlatform(
    predictions: readonly PlatformPrediction[] | undefined,
    trainNumber: string,
): string | null {
    const match = predictions?.find(
        (p) =>
            p.trainNumber === trainNumber &&
            p.confidence >= DISPLAY_RULES.predictedPlatform.minConfidence,
    );
    return match?.platform ?? null;
}

/** The alert to show: the first with a known reason, else the first one. */
export function mainAlert(
    alerts: readonly Alert[],
): { reason: DelayReason | null; text: string } | null {
    const known = alerts.find((a) => a.reason);
    const alert = known ?? alerts[0];
    if (!alert) return null;
    return {
        reason: alert.reason ?? null,
        text: alert.alertDescriptionText.trim(),
    };
}
