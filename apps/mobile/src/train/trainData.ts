import type {
    Alert,
    DelayReason,
    InfoService,
    PlatformPrediction,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";
import { roundMinutes, secondsToMinutes } from "@megisholavonat/core/delay";
import {
    isEstimate,
    predictedDelays,
    stopTiming,
} from "@megisholavonat/core/stops";
import { DISPLAY_RULES } from "@megisholavonat/core/tokens";
import { trainName, trainNumber } from "@megisholavonat/core/trainName";

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
    /**
     * Our estimate rather than a published time: shown as "≈17:44", by the
     * web's rule (core `isEstimate`)
     */
    approximate: boolean;
    /**
     * The time ahead is our forecast (the stop's predicted delay, or the
     * live delay carried forward), not a published realtime time
     */
    estimated: boolean;
    /** The train stands here: its time is the departure */
    standing: boolean;
    /** Announced platform */
    platform: string | null;
    /**
     * The other time at a stop where the train waits: the arrival of a
     * passed stop (shown by its departure), the departure of an upcoming one
     */
    secondary: { kind: "arrival" | "departure"; expected: number } | null;
}

export interface TrainStop {
    /** Index of the next stop; the stop count once the train has arrived */
    next: number;
    /** The stop the train stands at (its origin or a dwell), else null */
    standing: number | null;
    /** At its destination: every stop passed */
    arrived: boolean;
}

/**
 * Where the train is on its stop list, by the API's `activity` and
 * `dwellStopIndex` before its position: an arrived train has passed every
 * stop (its position still points at the final one), a train waiting to
 * depart has passed none, and one waiting out a stop is at that stop.
 */
export function trainStop(
    details: Pick<
        VehiclePositionWithDelay,
        "activity" | "dwellStopIndex" | "vehicleProgress" | "trip"
    >,
): TrainStop {
    const count = details.trip.stoptimes.length;
    if (details.activity === "arrived") {
        return { next: count, standing: null, arrived: true };
    }
    if (details.activity === "beforeDeparture") {
        return { next: 0, standing: 0, arrived: false };
    }
    const dwell = details.dwellStopIndex;
    if (dwell != null && dwell >= 0 && dwell < count) {
        return { next: dwell, standing: dwell, arrived: false };
    }
    return {
        next: details.vehicleProgress.nextStopIndex ?? 0,
        standing: null,
        arrived: false,
    };
}

/**
 * The stop list: passed stops with their actual times, then the next stop
 * and the rest, timed by the web's rules (core `stopTiming`): the per-stop
 * forecast, else a published realtime time, else the live delay carried
 * forward.
 */
export function stopRows(
    details: VehiclePositionWithDelay,
    /** Carry the live delay forward; off for a train not under way */
    carryDelay = true,
    /** The train's data is old or it isn't running: times ahead are "≈" */
    stale = false,
): StopRow[] {
    const stoptimes = details.trip.stoptimes;
    const { next, standing } = trainStop(details);
    const liveDelay = carryDelay ? roundMinutes(details.delay) : 0;
    const predicted = carryDelay
        ? predictedDelays(details)
        : new Map<number, number | null | undefined>();

    return stoptimes.map((st, index) => {
        const isFirst = index === 0;
        const isLast = index === stoptimes.length - 1;
        const state: StopState =
            index < next ? "passed" : index === next ? "next" : "upcoming";
        const passed = state === "passed";
        const isStanding = index === standing;
        const timing = stopTiming(
            st,
            index,
            passed,
            liveDelay,
            predicted.get(index),
            isLast,
        );
        // Passed stops show when the train left, the others when it arrives
        // (the first stop has only a departure, the last only an arrival);
        // the stop the train stands at, when it leaves
        const leaves =
            !isFirst && (passed || isStanding) ? timing.leaves : null;
        const shown = leaves ?? timing;
        let secondary: StopRow["secondary"] = null;
        if (!isFirst && timing.departure) {
            secondary = leaves
                ? { kind: "arrival", expected: timing.expected }
                : { kind: "departure", expected: timing.departure.expected };
        }
        return {
            key: `${index}-${st.stop.gtfsId ?? st.stop.name}`,
            name: st.stop.name,
            uic: st.stop.stationUicPricingCode ?? null,
            state,
            isFirst,
            isLast,
            scheduled: shown.scheduled,
            expected: shown.expected,
            delay: secondsToMinutes(shown.expected - shown.scheduled),
            approximate: isEstimate(
                { index, passed, timing: { estimated: shown.estimated } },
                stale,
            ),
            estimated: shown.estimated,
            standing: isStanding,
            platform: st.stop.platformCode ?? null,
            secondary,
        };
    });
}

/**
 * "10 TRANSCARPATHIA gyorsvonat" keeps a train's proper name; category
 * words such as "személyvonat" are dropped, like on the design boards.
 */
export function trainTitle(
    tripShortName: string,
    destination: string | null,
): { number: string; name: string | null; destination: string | null } {
    return {
        number: trainNumber(tripShortName),
        name: trainName(tripShortName),
        destination,
    };
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

/** Alerts with a known delay reason first, each text once. */
export function sortedAlerts(alerts: readonly Alert[]): Alert[] {
    const seen = new Set<string>();
    return [...alerts]
        .sort((a, b) => Number(!!b.reason) - Number(!!a.reason))
        .filter((a) => {
            const key = a.alertDescriptionText.trim();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

/** MNR2007 has no glyph for these ("Országos vonat" draws a stray "o"). */
const GLYPHLESS_SERVICES = new Set([339]);

/**
 * Services (bike, buffet, ...) for the whole trip, and those valid only on
 * part of it, by stop index.
 */
export function serviceGroups(
    services: readonly InfoService[],
    stopCount: number,
): { whole: InfoService[]; byStop: InfoService[][] } {
    const shown = services.filter(
        (s) =>
            s.displayable !== false &&
            !GLYPHLESS_SERVICES.has(Number(s.fontCode)),
    );
    const isWhole = (s: InfoService) =>
        s.fromStopIndex <= 0 && s.tillStopIndex >= stopCount - 1;
    const partial = shown.filter((s) => !isWhole(s));
    return {
        whole: shown.filter(isWhole),
        byStop: Array.from({ length: stopCount }, (_, index) =>
            partial.filter(
                (s) => index >= s.fromStopIndex && index <= s.tillStopIndex,
            ),
        ),
    };
}

/** The MNR2007 font glyph of a service. */
export function serviceGlyph(service: InfoService): string {
    return String.fromCharCode(Number(service.fontCode));
}
