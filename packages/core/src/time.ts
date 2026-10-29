import { DateTime } from "luxon";

// Port of apps/api/api/util/time.py (service_day_start, get_seconds_since_day)
// and apps/api/api/util/trip.py (seconds_into_service_day). Keep both in sync.

/** The time zone trains run on, whatever the device's own. */
export const BUDAPEST_TZ = "Europe/Budapest";

const DAY_S = 24 * 3600;

// A neighbouring service date replaces the trip's own only if it puts the
// time at least this much closer to the trip's schedule
const SERVICE_DATE_MISMATCH_S = 12 * 3600;

/**
 * The instant (ms since epoch) a service day's stoptime seconds count from:
 * local noon minus 12 hours, as in GTFS and OTP (`serviceDay`). This is local
 * midnight except on DST change days, where it is 23:00 (spring) or 01:00
 * (autumn) the night before, so times after the change read as wall-clock
 * times.
 */
export function serviceDayStart(serviceDate: string): number {
    const noon = DateTime.fromISO(serviceDate, { zone: BUDAPEST_TZ }).set({
        hour: 12,
    });
    // Subtract absolute time, not wall-clock time
    return noon.toMillis() - 12 * 3600 * 1000;
}

function isServiceDate(value: string): boolean {
    return (
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        DateTime.fromISO(value, { zone: BUDAPEST_TZ }).isValid
    );
}

/**
 * Seconds from the start of the service day `sinceDate` (YYYY-MM-DD) to
 * `date`, the clock OTP stoptimes use. Exceeds 86400 past midnight.
 */
export function getSecondsSinceDay(sinceDate: string, date: Date = new Date()) {
    const serviceDate = isServiceDate(sinceDate)
        ? sinceDate
        : // Unknown service date: assume today's (local) service day
          (DateTime.fromJSDate(date, { zone: BUDAPEST_TZ }).toISODate() ?? "");

    return Math.floor((date.getTime() - serviceDayStart(serviceDate)) / 1000);
}

type StoptimeTimes = {
    scheduledArrival?: number | null;
    scheduledDeparture?: number | null;
    realtimeArrival?: number | null;
    realtimeDeparture?: number | null;
};

export type TripTimes = {
    serviceDate?: string | null;
    stoptimes?: readonly StoptimeTimes[] | null;
};

/**
 * (first departure, last arrival) of the trip, widened by the realtime
 * estimate when there is one, or null if the schedule is unknown.
 */
function expectedWindow(trip: TripTimes): [number, number] | null {
    const stoptimes = trip.stoptimes;
    if (!stoptimes || stoptimes.length === 0) return null;
    const firstStop = stoptimes[0];
    const lastStop = stoptimes[stoptimes.length - 1];
    const first = firstStop?.scheduledDeparture;
    const last = lastStop?.scheduledArrival;
    if (first == null || last == null) return null;
    const realFirst = firstStop?.realtimeDeparture || first;
    const realLast = lastStop?.realtimeArrival || last;
    return [Math.min(realFirst, first), Math.max(realLast, last)];
}

function outside([first, last]: [number, number], now: number): number {
    return Math.max(0, first - now, now - last);
}

/** `serviceDate` (YYYY-MM-DD) moved by whole calendar days. */
export function shiftDate(serviceDate: string, days: number): string {
    return (
        DateTime.fromISO(serviceDate, { zone: "UTC" })
            .plus({ days })
            .toISODate() ?? serviceDate
    );
}

/** The calendar date in Budapest at `date`, YYYY-MM-DD. */
export function budapestDate(date: Date = new Date()): string {
    return DateTime.fromJSDate(date, { zone: BUDAPEST_TZ }).toISODate() ?? "";
}

/** ISO weekday of a YYYY-MM-DD date: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(isoDate: string): number {
    return DateTime.fromISO(isoDate, { zone: "UTC" }).weekday;
}

/**
 * The service date (YYYY-MM-DD) the trip's stoptimes really count from at
 * `date`: OTP's `serviceDate`, or the neighbouring date when that puts
 * `date` far closer to the trip's schedule.
 *
 * OTP's `serviceDate` does not always match the day the stoptimes count
 * from: HÉV trips after midnight carry the previous day's date with
 * stoptimes under 86400, and an overnight train (10) can carry the next
 * day's date while still running the previous day's departure. A
 * neighbouring date wins only if it is at least 12 h closer (the API's
 * SERVICE_DATE_MISMATCH_S), so `date` only has to be within about half a
 * day of the run. Unknown dates or schedules keep `serviceDate`.
 */
export function effectiveServiceDate(
    trip: TripTimes,
    date: Date = new Date(),
): string {
    const serviceDate = trip.serviceDate ?? "";
    const window = expectedWindow(trip);
    if (window === null || !isServiceDate(serviceDate)) return serviceDate;

    // Another date has to beat this to be used
    let best = serviceDate;
    let toBeat =
        outside(window, getSecondsSinceDay(serviceDate, date)) -
        SERVICE_DATE_MISMATCH_S;
    for (const offset of [-1, 1]) {
        const other = shiftDate(serviceDate, offset);
        const otherOutside = outside(window, getSecondsSinceDay(other, date));
        if (otherOutside <= toBeat) {
            best = other;
            toBeat = otherOutside - 1;
        }
    }
    return best;
}

/**
 * Seconds since the start of the trip's service day, the same clock the
 * stoptimes use. Exceeds 86400 for trips past midnight. Counts from
 * `effectiveServiceDate`, so OTP's off-by-a-day dates read right.
 */
export function secondsIntoServiceDay(
    trip: TripTimes,
    date: Date = new Date(),
): number {
    return getSecondsSinceDay(effectiveServiceDate(trip, date), date);
}

export function formatSecondsAsTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600) % 24;
    const minutes = Math.floor((seconds % 3600) / 60);

    const h = hours < 10 ? `0${hours}` : String(hours);
    const m = minutes < 10 ? `0${minutes}` : String(minutes);

    return `${h}:${m}`;
}

/** A wall-clock time in Budapest. */
export interface BudapestTime {
    year: number;
    /** 1–12 */
    month: number;
    day: number;
    hour: number;
    minute: number;
}

/** The Budapest wall-clock time of an instant (ms since epoch). */
export function budapestTime(ms: number): BudapestTime {
    const t = DateTime.fromMillis(ms, { zone: BUDAPEST_TZ });
    return {
        year: t.year,
        month: t.month,
        day: t.day,
        hour: t.hour,
        minute: t.minute,
    };
}

/**
 * The instant (ms since epoch) of a Budapest wall-clock time, whatever the
 * device's own time zone (a visitor's phone may still be on home time).
 */
export function fromBudapestTime(time: BudapestTime): number {
    return DateTime.fromObject(time, { zone: BUDAPEST_TZ }).toMillis();
}

/**
 * "04:10": the Budapest wall-clock time of an instant (Unix seconds), always
 * 24-hour whatever the UI language, like the timetables.
 */
export function formatClock(epochSeconds: number): string {
    return DateTime.fromSeconds(epochSeconds, { zone: BUDAPEST_TZ }).toFormat(
        "HH:mm",
    );
}

/** "2026-10-29T15:00" in Budapest time, for a time input and the API. */
export function toLocalInput(date: Date): string {
    return DateTime.fromJSDate(date, { zone: BUDAPEST_TZ }).toFormat(
        "yyyy-MM-dd'T'HH:mm",
    );
}

function validityFormat(locale: string, withTime: boolean) {
    return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
        month: "short",
        day: "numeric",
        ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
        timeZone: BUDAPEST_TZ,
    });
}

/** One end of a validity: "okt. 29." or, with the time, "okt. 29. 01:30". */
export function formatValidityDate(
    epochSeconds: number,
    locale: string,
    withTime = false,
): string {
    return validityFormat(locale, withTime).format(
        new Date(epochSeconds * 1000),
    );
}

/**
 * A validity range in Budapest time: "okt. 17. – nov. 6.", with times when
 * it lasts less than a day ("okt. 29. 01:30 – 04:34") or when asked.
 */
export function formatValidity(
    start: number,
    end: number,
    locale: string,
    withTime = end - start < DAY_S,
): string {
    const format = validityFormat(locale, withTime);
    const from = new Date(start * 1000);
    const to = new Date(end * 1000);
    try {
        return format.formatRange(from, to);
    } catch {
        return `${format.format(from)} – ${format.format(to)}`;
    }
}
