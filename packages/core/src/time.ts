import { DateTime } from "luxon";

// Port of apps/api/api/util/time.py (service_day_start, get_seconds_since_day)
// and apps/api/api/util/trip.py (seconds_into_service_day). Keep both in sync.

const BUDAPEST_TZ = "Europe/Budapest";

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

type TripTimes = {
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

function shiftDate(serviceDate: string, days: number): string {
    return (
        DateTime.fromISO(serviceDate, { zone: "UTC" })
            .plus({ days })
            .toISODate() ?? serviceDate
    );
}

/**
 * Seconds since the start of the trip's service day, the same clock the
 * stoptimes use. Exceeds 86400 for trips past midnight.
 *
 * OTP's `serviceDate` does not always match the day the stoptimes count
 * from: HÉV trips after midnight carry the previous day's date with
 * stoptimes under 86400, and an overnight train can carry the next day's
 * date while still running the previous day's departure. When the previous
 * or next date puts `date` far closer to the trip's schedule, that date is
 * used instead.
 */
export function secondsIntoServiceDay(
    trip: TripTimes,
    date: Date = new Date(),
): number {
    const serviceDate = trip.serviceDate ?? "";
    const now = getSecondsSinceDay(serviceDate, date);
    const window = expectedWindow(trip);
    if (window === null || !isServiceDate(serviceDate)) return now;

    // Another date has to beat this to be used
    let best = now;
    let toBeat = outside(window, now) - SERVICE_DATE_MISMATCH_S;
    for (const offset of [-1, 1]) {
        const other = getSecondsSinceDay(shiftDate(serviceDate, offset), date);
        const otherOutside = outside(window, other);
        if (otherOutside <= toBeat) {
            best = other;
            toBeat = otherOutside - 1;
        }
    }
    return best;
}

export function formatSecondsAsTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600) % 24;
    const minutes = Math.floor((seconds % 3600) / 60);

    const h = hours < 10 ? `0${hours}` : String(hours);
    const m = minutes < 10 ? `0${minutes}` : String(minutes);

    return `${h}:${m}`;
}
