import { DateTime } from "luxon";

// When the next run of a followed train is. Same semantics as the API's
// commute follows (apps/api/api/services/commute.py): weekdays are ISO
// (1 = Monday) and count the local calendar day of departure from the
// boarding station.

const BUDAPEST_TZ = "Europe/Budapest";
const DAY_S = 24 * 3600;

/** Keep showing a run this long after its scheduled departure */
export const COMMUTE_GRACE_S = 60 * 60;
/** A live run of the train left the boarding stop at most this long ago */
const MAX_RUN_S = 20 * 3600;

export interface CommuteSchedule {
    /** ISO weekdays, 1 = Monday ... 7 = Sunday; empty for a single run */
    weekdays: readonly number[];
    /** Local departure time at the boarding station, seconds after midnight */
    departureS: number;
    /** Single run only: its local date of departure (YYYY-MM-DD) */
    date?: string | null;
    /** Scheduled time from boarding to the end of the trip, seconds */
    runS?: number | null;
}

export interface Occurrence {
    /** Local date of departure (YYYY-MM-DD) */
    date: string;
    /** Scheduled departure, unix seconds */
    departure: number;
    /** 0 today, 1 tomorrow, ...; -1 for a run that left yesterday */
    daysAhead: number;
    /** ISO weekday of the run */
    weekday: number;
}

/** Local time of day (seconds after midnight) of a service-day time. */
export function timeOfDay(serviceDaySeconds: number): number {
    return ((serviceDaySeconds % DAY_S) + DAY_S) % DAY_S;
}

/**
 * Local date of departure for a stoptime given in seconds into the trip's
 * service day (which exceeds 86400 after midnight).
 */
export function departureDate(
    serviceDate: string,
    serviceDaySeconds: number,
): string {
    return (
        DateTime.fromISO(serviceDate, { zone: BUDAPEST_TZ })
            .plus({ days: Math.floor(serviceDaySeconds / DAY_S) })
            .toISODate() ?? serviceDate
    );
}

function at(day: DateTime, departureS: number): DateTime {
    return day.startOf("day").set({
        hour: Math.floor(departureS / 3600),
        minute: Math.floor((departureS % 3600) / 60),
    });
}

/** The runs of a schedule from `from` to `to` days ahead of today. */
function runs(
    schedule: CommuteSchedule,
    now: Date,
    from: number,
    to: number,
): Occurrence[] {
    const today = DateTime.fromJSDate(now, { zone: BUDAPEST_TZ }).startOf(
        "day",
    );
    const days = schedule.weekdays;
    const out: Occurrence[] = [];
    for (let ahead = from; ahead <= to; ahead++) {
        const day = today.plus({ days: ahead });
        const date = day.toISODate() ?? "";
        const matches =
            days.length > 0
                ? days.includes(day.weekday)
                : schedule.date === date;
        if (!matches) continue;
        out.push({
            date,
            departure: Math.floor(at(day, schedule.departureS).toSeconds()),
            daysAhead: ahead,
            weekday: day.weekday,
        });
    }
    return out;
}

/**
 * The next run of a followed train that is still worth showing: one until
 * `graceS` after it left, otherwise the next matching day. Null for a single
 * run that is over, or a schedule without days.
 */
export function nextOccurrence(
    schedule: CommuteSchedule,
    now: Date = new Date(),
    graceS: number = COMMUTE_GRACE_S,
): Occurrence | null {
    const nowS = now.getTime() / 1000;
    const back = Math.ceil(graceS / DAY_S);
    return (
        runs(schedule, now, -back, 7).find(
            (run) => run.departure + graceS >= nowS,
        ) ?? null
    );
}

/**
 * The run of a followed train to show now. A run stays until its scheduled
 * arrival (at least an hour after it left). While a train with the followed
 * number is on the rails, the run it is on wins over the next one when it
 * left more recently than the next one leaves: a train followed after it
 * passed the boarding stop is still today's run, not tomorrow's.
 */
export function currentOccurrence(
    schedule: CommuteSchedule,
    now: Date = new Date(),
    running = false,
): Occurrence | null {
    const nowS = now.getTime() / 1000;
    const next = nextOccurrence(
        schedule,
        now,
        Math.max(COMMUTE_GRACE_S, schedule.runS ?? 0),
    );
    if (!running || (next && next.departure <= nowS)) return next;
    const last = runs(schedule, now, -1, 0)
        .filter((run) => run.departure <= nowS)
        .at(-1);
    if (!last || nowS - last.departure > MAX_RUN_S) return next;
    if (next && next.departure - nowS < nowS - last.departure) return next;
    return last;
}

/**
 * Index of the stop to suggest boarding at: the most recently viewed station
 * still ahead of the train, else its next stop. Never a stop it has passed,
 * and never the last stop.
 */
export function defaultBoardingIndex(
    stationIds: readonly (string | null)[],
    nextIndex: number | null,
    recentIds: readonly string[] = [],
): number {
    const last = stationIds.length - 2;
    if (last < 0) return 0;
    const first = Math.min(Math.max(nextIndex ?? 0, 0), last);
    for (const id of recentIds) {
        const i = stationIds.indexOf(id, first);
        if (i >= first && i <= last) return i;
    }
    return first;
}

/** Whether a single-run follow is over and can be dropped. */
export function isExpired(
    schedule: CommuteSchedule,
    now: Date = new Date(),
): boolean {
    return (
        schedule.weekdays.length === 0 && nextOccurrence(schedule, now) === null
    );
}

/** ISO weekday of a moment in Budapest. */
export function localWeekday(now: Date = new Date()): number {
    return DateTime.fromJSDate(now, { zone: BUDAPEST_TZ }).weekday;
}

/** Local date (YYYY-MM-DD) of a moment in Budapest. */
export function localDate(now: Date = new Date()): string {
    return DateTime.fromJSDate(now, { zone: BUDAPEST_TZ }).toISODate() ?? "";
}
