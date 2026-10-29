import type {
    Alert,
    DelayReason,
    InfoService,
    PlatformPrediction,
    StopTimeWithCounty,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";
import { roundMinutes, secondsToMinutes } from "@megisholavonat/core/delay";
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
    /**
     * The time ahead is our forecast (the stop's predicted delay, or the
     * live delay carried forward), not the timetable's: told with "≈" when
     * shared, as the web does
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

/** A stop's wait shorter than this shows a single time. */
const MIN_DWELL_S = 60;

/** Optional per-stop forecast; not every API version sends it. */
function predictedDelay(stoptime: StopTimeWithCounty): number | null {
    const value = (stoptime as { predictedDelay?: unknown }).predictedDelay;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
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
 * and the rest with the live delay carried forward (or the per-stop
 * `predictedDelay` when the API sends one).
 */
export function stopRows(
    details: VehiclePositionWithDelay,
    /** Carry the live delay forward; off for a train not under way */
    carryDelay = true,
): StopRow[] {
    const stoptimes = details.trip.stoptimes;
    const { next, standing } = trainStop(details);
    const liveDelay = carryDelay ? Math.max(0, roundMinutes(details.delay)) : 0;

    return stoptimes.map((st, index) => {
        const isFirst = index === 0;
        const isLast = index === stoptimes.length - 1;
        const state: StopState =
            index < next ? "passed" : index === next ? "next" : "upcoming";
        const isStanding = index === standing;
        // Passed stops show when the train left, the others when it arrives
        // (the first stop has only a departure, the last only an arrival);
        // the stop the train stands at, when it leaves
        const useDeparture =
            isFirst || ((state === "passed" || isStanding) && !isLast);
        const scheduled = useDeparture
            ? st.scheduledDeparture
            : st.scheduledArrival;
        let expected: number;
        let delay: number;
        let estimated = false;
        if (state === "passed") {
            expected = useDeparture ? st.realtimeDeparture : st.realtimeArrival;
            delay = secondsToMinutes(expected - scheduled);
        } else {
            const predicted = predictedDelay(st);
            delay = Math.max(0, roundMinutes(predicted ?? liveDelay));
            expected = scheduled + delay * 60;
            estimated = predicted !== null || delay > 0;
        }
        let secondary: StopRow["secondary"] = null;
        const dwell = st.scheduledDeparture - st.scheduledArrival;
        if (!isFirst && !isLast && dwell >= MIN_DWELL_S) {
            secondary =
                state === "passed" || isStanding
                    ? { kind: "arrival", expected: st.realtimeArrival }
                    : {
                          kind: "departure",
                          expected: st.scheduledDeparture + delay * 60,
                      };
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
            estimated,
            standing: isStanding,
            platform: st.stop.platformCode ?? null,
            secondary,
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
