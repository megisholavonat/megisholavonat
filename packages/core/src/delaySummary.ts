/**
 * The delay summary of one run ("A 7:15-ös Szolnok → Budapest-Nyugati ma
 * 23 percet késett"): its stable link and the card its link previews.
 * Built from the API's run summary (our GPS-derived delay
 * at each stop), shared by the web card page and both apps' share actions.
 */

import type { RunSummary } from "@megisholavonat/api-client";
import {
    type CommuteSchedule,
    nextOccurrence,
    type Occurrence,
    tripRun,
} from "./commute";
import { ON_TIME_MAX_MIN } from "./constants";
import { type DelayLevel, getDelayLevel, roundMinutes } from "./delay";
import type { DelayReasonCode } from "./delayReasons";
import type { Locale } from "./i18n";
import { huSuffix, huVowelStart } from "./share";
import {
    budapestDate,
    formatSecondsAsTime,
    shiftDate,
    type TripTimes,
} from "./time";
import { trainName } from "./trainName";

/** Path segment of the card page, in both locales (the link is stable). */
export const DELAY_SUMMARY_SEGMENT = "kesesek";

/** The measurement note every card and page carries. */
export const MEASUREMENT_NOTE: Record<Locale, string> = {
    hu: "Mégis hol a vonat? mérés, nem hivatalos MÁV igazolás",
    en: "Mégis hol a vonat? measurement, not an official MÁV certificate",
};

const TRAIN_NUMBER = /^[0-9A-Za-z]{1,12}$/;
const STATION_ID = /^[0-9]{1,12}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A train number as it may appear in a card link ("2614", "H8000"). */
export function isTrainNumber(value: string): boolean {
    return TRAIN_NUMBER.test(value);
}

/** A UIC station code as it may appear in a card link. */
export function isStationId(value: string | null | undefined): value is string {
    return !!value && STATION_ID.test(value);
}

/** A real calendar date, YYYY-MM-DD. */
export function isRunDate(value: string): boolean {
    const m = ISO_DATE.exec(value);
    if (!m) return false;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(Date.UTC(y, mo - 1, d));
    return (
        date.getUTCFullYear() === y &&
        date.getUTCMonth() === mo - 1 &&
        date.getUTCDate() === d
    );
}

/** The boarding and alighting stations a card is about (UIC codes). */
export interface RunStops {
    from?: string | null;
    to?: string | null;
}

/** "/hu/kesesek/2614/2026-10-29?from=005513748&to=005510033" */
export function delaySummaryPath(
    locale: Locale,
    number: string,
    date: string,
    stops: RunStops = {},
): string {
    // Station ids are digits only: nothing to encode
    const search = [
        isStationId(stops.from) ? `from=${stops.from}` : null,
        isStationId(stops.to) ? `to=${stops.to}` : null,
    ]
        .filter(Boolean)
        .join("&");
    return `/${locale}/${DELAY_SUMMARY_SEGMENT}/${encodeURIComponent(number)}/${date}${search ? `?${search}` : ""}`;
}

/** The card link on `origin` (the site's own, never a request header). */
export function delaySummaryUrl(
    origin: string,
    locale: Locale,
    number: string,
    date: string,
    stops: RunStops = {},
): string {
    return `${origin.replace(/\/$/, "")}${delaySummaryPath(locale, number, date, stops)}`;
}

/**
 * The date a run goes by in its card link: the day its stoptimes count from,
 * which is the day it leaves its origin. OTP's own `serviceDate` is a day
 * off for HÉVs after midnight and train 10; `tripRun` puts it right, so
 * `now` must be within about half a day of the run (a live train is).
 */
export function runDate(
    trip: TripTimes & { serviceDate: string },
    now: Date = new Date(),
): string {
    const first = trip.stoptimes?.[0];
    const seconds = first?.scheduledDeparture ?? first?.scheduledArrival ?? 0;
    return tripRun(trip, seconds, now).serviceDate;
}

/**
 * What the run did at the stop the card is about: late, on time (at most
 * five minutes late), cancelled, or not measured.
 */
export type DelayOutcome = "late" | "onTime" | "cancelled" | "unknown";

export interface DelaySummaryStop {
    name: string;
    stationId: string;
    /** Seconds into the run's service day; past 86400 after midnight */
    scheduled: number | null;
    /** `scheduled` plus the measured delay, when there is one */
    actual: number | null;
}

export interface DelaySummary {
    number: string;
    /** "TRANSCARPATHIA" for named trains */
    name: string | null;
    routeShortName: string | null;
    /** The run's date, YYYY-MM-DD */
    date: string;
    /** Boarding stop (the origin without one) and its departure */
    from: DelaySummaryStop;
    /** Alighting stop (the destination without one) and its arrival */
    to: DelaySummaryStop;
    /**
     * The stop the delay was measured at, when it is not `to`: the run is
     * still on its way, or its arrival there was not recorded
     */
    measuredAt: DelaySummaryStop | null;
    outcome: DelayOutcome;
    /** Whole minutes late (never negative), null unless late or on time */
    delay: number | null;
    /** Colour of the delay: on time up to five minutes, as the copy says */
    level: DelayLevel;
    /** The run is still on its way: the delay is the one so far */
    soFar: boolean;
    reason: DelayReasonCode | null;
}

function indexOf(
    summary: RunSummary,
    stationId: string | null | undefined,
    after = -1,
): number {
    if (!stationId) return -1;
    return summary.stops.findIndex(
        (s, i) => i > after && s.stationId === stationId,
    );
}

function stopAt(
    summary: RunSummary,
    index: number,
    kind: "arrival" | "departure",
): DelaySummaryStop {
    const stop = summary.stops[index];
    if (!stop)
        return { name: "", stationId: "", scheduled: null, actual: null };
    const scheduled =
        kind === "arrival"
            ? (stop.scheduledArrivalS ?? stop.scheduledDepartureS ?? null)
            : (stop.scheduledDepartureS ?? stop.scheduledArrivalS ?? null);
    const delay = stop.delayMin;
    return {
        name: stop.name,
        stationId: stop.stationId,
        scheduled,
        actual:
            scheduled != null && delay != null
                ? scheduled + Math.round(delay * 60)
                : null,
    };
}

/**
 * The card of a run for the stops a rider gave: the delay at the alighting
 * stop (the destination without one). A run still on its way, or one whose
 * arrival there was not recorded, tells the last delay measured before it.
 */
export function delaySummary(
    summary: RunSummary,
    stops: RunStops = {},
): DelaySummary {
    const last = summary.stops.length - 1;
    const fromFound = indexOf(summary, stops.from);
    const fromIdx = fromFound >= 0 && fromFound < last ? fromFound : 0;
    const toFound = indexOf(summary, stops.to, fromIdx);
    const toIdx = toFound > fromIdx ? toFound : last;

    const from = stopAt(summary, fromIdx, "departure");
    const to = stopAt(summary, toIdx, "arrival");
    const fromStop = summary.stops[fromIdx];
    const toStop = summary.stops[toIdx];
    const cancelled =
        summary.cancelled || !!fromStop?.cancelled || !!toStop?.cancelled;

    // Where the delay comes from: the stop itself, or the last one before it
    let measuredIdx = -1;
    if (toStop?.delayMin != null) {
        measuredIdx = toIdx;
    } else {
        for (let i = toIdx - 1; i >= 0; i--) {
            if (summary.stops[i]?.delayMin != null) {
                measuredIdx = i;
                break;
            }
        }
    }
    const measured = summary.stops[measuredIdx];
    const minutes =
        measured?.delayMin != null
            ? Math.max(0, roundMinutes(measured.delayMin))
            : null;
    const outcome: DelayOutcome = cancelled
        ? "cancelled"
        : minutes == null
          ? "unknown"
          : minutes <= ON_TIME_MAX_MIN
            ? "onTime"
            : "late";
    const shown = outcome === "late" || outcome === "onTime";
    return {
        number: summary.trainNumber,
        name: trainName(summary.tripShortName),
        routeShortName: summary.routeShortName ?? null,
        date: summary.serviceDate,
        from,
        to,
        measuredAt:
            shown && measuredIdx !== toIdx
                ? stopAt(summary, measuredIdx, "departure")
                : null,
        outcome,
        delay: shown ? minutes : null,
        level: shown && minutes != null ? getDelayLevel(minutes) : "onTime",
        soFar: shown && !summary.finished && measuredIdx !== toIdx,
        reason: (summary.reason?.code as DelayReasonCode | undefined) ?? null,
    };
}

/** "7:15" from seconds into the service day. */
export function clockTime(seconds: number): string {
    return formatSecondsAsTime(seconds).replace(/^0(\d)/, "$1");
}

const HU_MONTHS = [
    "január",
    "február",
    "március",
    "április",
    "május",
    "június",
    "július",
    "augusztus",
    "szeptember",
    "október",
    "november",
    "december",
];
const EN_MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

/** "27-én", "1-jén", "3-án": a day of the month as "on the Nth". */
export function huDayOn(day: number): string {
    if (day === 1) return "1-jén";
    const ones = day % 10;
    const suffix =
        ones === 0
            ? day === 10
                ? "én"
                : "án"
            : ones === 2 && day !== 2
              ? "én"
              : [3, 6, 8].includes(ones) || day === 2
                ? "án"
                : "én";
    return `${day}-${suffix}`;
}

/** "ma", "tegnap", "október 27-én"; "today", "yesterday", "on 27 October". */
export function runDay(locale: Locale, date: string, now: Date): string {
    const today = budapestDate(now);
    if (date === today) return locale === "hu" ? "ma" : "today";
    if (date === shiftDate(today, -1)) {
        return locale === "hu" ? "tegnap" : "yesterday";
    }
    const [, month, day] = date.split("-").map(Number);
    const m = (month ?? 1) - 1;
    return locale === "hu"
        ? `${HU_MONTHS[m]} ${huDayOn(day ?? 1)}`
        : `on ${day} ${EN_MONTHS[m]}`;
}

/** "Az 5:15-ös", "A 7 órás" (the run by its departure). */
function huTimeSubject(seconds: number): string {
    const time = clockTime(seconds);
    const [h, m] = time.split(":").map(Number);
    const hour = h ?? 0;
    const minute = m ?? 0;
    const article = hour !== 0 && huVowelStart(hour) ? "Az" : "A";
    return minute === 0
        ? `${article} ${hour} órás`
        : `${article} ${time}-${huSuffix(minute)}`;
}

/**
 * "A 7:15-ös Szolnok → Budapest-Nyugati ma 23 percet késett". Minutes as a
 * number; "pontos" only up to five minutes.
 */
export function delaySummarySentence(
    locale: Locale,
    card: DelaySummary,
    now: Date = new Date(),
): string {
    const route = `${card.from.name} → ${card.to.name}`;
    const day = runDay(locale, card.date, now);
    const departure = card.from.scheduled;
    const n = card.delay ?? 0;
    if (locale === "hu") {
        const subject =
            departure != null
                ? `${huTimeSubject(departure)} ${route}`
                : `${huTrainSubjectShort(card.number)} (${route})`;
        // Not measured at the rider's stop: say where it was
        const at = card.measuredAt
            ? `, utolsó mérés: ${card.measuredAt.name}`
            : "";
        switch (card.outcome) {
            case "late":
                return card.soFar
                    ? `${subject} eddig ${n} percet késett${at}`
                    : `${subject} ${day} ${n} percet késett${at}`;
            case "onTime":
                return card.soFar
                    ? `${subject} eddig pontos${at}`
                    : card.measuredAt
                      ? `${subject} ${day} pontos volt${at}`
                      : `${subject} ${day} pontosan érkezett`;
            case "cancelled":
                return `${subject} ${day} elmaradt`;
            default:
                return `${subject} ${day}: nincs mért késés`;
        }
    }
    const subject =
        departure != null
            ? `The ${clockTime(departure)} ${route}`
            : `Train ${card.number} (${route})`;
    const at = card.measuredAt
        ? `, last measured at ${card.measuredAt.name}`
        : "";
    switch (card.outcome) {
        case "late":
            return card.soFar
                ? `${subject} has been ${n} min late so far${at}`
                : `${subject} was ${n} min late ${day}${at}`;
        case "onTime":
            return card.soFar
                ? `${subject} has been on time so far${at}`
                : `${subject} was on time ${day}${at}`;
        case "cancelled":
            return `${subject} was cancelled ${day}`;
        default:
            return `${subject}: no delay measured ${day}`;
    }
}

/** "A 2614-es" without the noun, for a run with no departure time. */
function huTrainSubjectShort(number: string): string {
    if (!/^\d+$/.test(number)) return `A ${number}`;
    const n = Number(number);
    return `${huVowelStart(n) ? "Az" : "A"} ${number}-${huSuffix(n)}`;
}

/** A followed run can be shared this long after it left its boarding stop. */
export const SHARE_RUN_WITHIN_S = 12 * 3600;

/**
 * The run of a followed train that has left most recently, within
 * SHARE_RUN_WITHIN_S: the one whose delay a commuter may want to share.
 * Null before the first run of the day leaves.
 */
export function recentRun(
    schedule: CommuteSchedule,
    now: Date = new Date(),
): Occurrence | null {
    const run = nextOccurrence(schedule, now, SHARE_RUN_WITHIN_S);
    return run && run.departure <= now.getTime() / 1000 ? run : null;
}
