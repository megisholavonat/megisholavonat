import type {
    CommuteFollowCreate,
    TrainFeatureCollection,
    TripFollowCreate,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";
import {
    currentOccurrence,
    defaultBoardingIndex,
    tripRun,
} from "@megisholavonat/core/commute";
import {
    budapestDate,
    effectiveServiceDate,
    serviceDayStart,
    shiftDate,
} from "@megisholavonat/core/time";
import { trainTitle } from "../train/trainData";

// Followed trains: one trip ("only today") or a commute on some weekdays.
// The API keeps the alert subscription; this model keeps what the app needs
// to show them without a network round trip. Pure, unit tested under Node.

/** The API's default; alerts fire when the delay is strictly above it. */
export const DEFAULT_THRESHOLD_MIN = 5;
export const THRESHOLDS_MIN = [3, 5, 10, 15, 20, 30] as const;
/** ISO weekdays, Monday first */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** A trip stays on home this long after its scheduled arrival. */
const AFTER_ARRIVAL_MS = 60 * 60_000;
const DAY_S = 86_400;

export interface StopOption {
    /** Platform-level OTP stop id, e.g. "1:005501024_14" */
    stopId: string | null;
    /** UIC station code */
    stationId: string | null;
    name: string;
    /** Scheduled time at the stop, seconds since the start of the service day */
    time: number;
}

export interface LocalFollow {
    /** Follow id on the API */
    id: string;
    kind: "trip" | "commute";
    tripShortName: string;
    routeShortName: string | null;
    /** The train's stops when it was followed */
    stops: StopOption[];
    /** Boarding and alighting, indexes into `stops` */
    from: number;
    to: number;
    /** Commute days, ISO weekdays; empty for a single trip */
    weekdays: number[];
    /** Trip follows only */
    tripId: string | null;
    serviceDate: string | null;
    /** The vehicle last seen running this train */
    vehicleId: string | null;
    delayThresholdMin: number;
    notifyPlatformChange: boolean;
    /** iOS: show the run on the lock screen as a Live Activity (local only) */
    liveActivity?: boolean;
}

/** What the follow screen edits. */
export interface FollowDraft {
    weekdays: number[];
    from: number;
    to: number;
    delayThresholdMin: number;
    notifyPlatformChange: boolean;
    liveActivity: boolean;
}

/** UIC station code of a stop, as the API derives it (util/stop.py). */
export function stationIdOf(stop: {
    stationUicPricingCode?: string | null;
    gtfsId?: string | null;
}): string | null {
    if (stop.stationUicPricingCode) return stop.stationUicPricingCode;
    if (!stop.gtfsId) return null;
    return stop.gtfsId.split(":").slice(1).join(":").split("_")[0] || null;
}

/** First word of the trip name: "559 AGRIA InterRégió" -> "559". */
export function trainNumber(tripShortName: string): string {
    return tripShortName.trim().split(/\s+/)[0]?.toLocaleLowerCase() ?? "";
}

export function stopOptions(details: VehiclePositionWithDelay): StopOption[] {
    const stoptimes = details.trip.stoptimes;
    return stoptimes.map((st, i) => ({
        stopId: st.stop.gtfsId ?? null,
        stationId: stationIdOf(st.stop),
        name: st.stop.name,
        time:
            i === stoptimes.length - 1
                ? st.scheduledArrival
                : st.scheduledDeparture,
    }));
}

/** Boarding at the next stop (never a passed one), alighting at the end. */
export function defaultDraft(details: VehiclePositionWithDelay): FollowDraft {
    const stoptimes = details.trip.stoptimes;
    const count = stoptimes.length;
    return {
        weekdays: [],
        from: defaultBoardingIndex(
            stoptimes.map((st) => stationIdOf(st.stop)),
            details.vehicleProgress.nextStopIndex ?? null,
        ),
        to: count - 1,
        delayThresholdMin: DEFAULT_THRESHOLD_MIN,
        notifyPlatformChange: true,
        liveActivity: false,
    };
}

export function draftOf(follow: LocalFollow): FollowDraft {
    return {
        weekdays: follow.weekdays,
        from: follow.from,
        to: follow.to,
        delayThresholdMin: follow.delayThresholdMin,
        notifyPlatformChange: follow.notifyPlatformChange,
        liveActivity: follow.liveActivity ?? false,
    };
}

/** Moving the boarding stop past the alighting one moves that along. */
export function withFrom(draft: FollowDraft, from: number): FollowDraft {
    return { ...draft, from, to: Math.max(draft.to, from + 1) };
}

export function toggleWeekday(weekdays: number[], day: number): number[] {
    return weekdays.includes(day)
        ? weekdays.filter((d) => d !== day)
        : [...weekdays, day].sort((a, b) => a - b);
}

/** The API body creating `draft` of a train. */
export function createBody(
    train: Pick<LocalFollow, "tripShortName" | "stops" | "tripId">,
    serviceDate: string | null,
    draft: Omit<FollowDraft, "liveActivity">,
): TripFollowCreate | CommuteFollowCreate | null {
    const from = train.stops[draft.from];
    const to = train.stops[draft.to];
    if (!from || !to || draft.from >= draft.to) return null;
    const prefs = {
        alertsEnabled: true,
        delayThresholdMin: draft.delayThresholdMin,
        notifyPlatformChange: draft.notifyPlatformChange,
    };
    if (draft.weekdays.length > 0) {
        if (!from.stationId) return null;
        return {
            kind: "commute",
            tripShortName: train.tripShortName,
            weekdays: draft.weekdays,
            fromStationId: from.stationId,
            toStationId: to.stationId,
            ...prefs,
        };
    }
    if (!train.tripId || !serviceDate) return null;
    return {
        kind: "trip",
        tripId: train.tripId,
        serviceDate,
        tripShortName: train.tripShortName,
        fromStopId: from.stopId,
        toStopId: to.stopId,
        ...prefs,
    };
}

export interface Run {
    /**
     * Service date the run's stoptimes count from: OTP's own for a trip,
     * resolved for HÉVs after midnight and train 10 (core `tripRun`)
     */
    serviceDate: string;
    /** Scheduled departure from the boarding stop, ms since epoch */
    departure: number;
    /** 0 today, 1 tomorrow, ... (Budapest calendar days) */
    dayOffset: number;
}

/**
 * The run of a follow to show: a trip on its service date, a commute on the
 * next of its weekdays it hasn't left on yet (kept until it arrives, and
 * while a train with its number is still out). Null once a trip is over.
 */
export function nextRun(
    follow: LocalFollow,
    now: Date = new Date(),
    running = false,
): Run | null {
    const board = follow.stops[follow.from];
    if (!board) return null;
    const today = budapestDate(now);
    // The service date's stoptimes run past midnight; the calendar day of
    // departure is what the commute's weekdays mean (as in the API)
    const daysPast = Math.floor(board.time / DAY_S);

    const runOn = (serviceDate: string) =>
        serviceDayStart(serviceDate) + board.time * 1000;

    if (follow.kind === "trip") {
        if (!follow.serviceDate) return null;
        // OTP dates HÉVs after midnight a day early and train 10 a day late
        const run = tripRun(
            asTrip(follow, follow.serviceDate),
            board.time,
            now,
        );
        const departure = run.at * 1000;
        const alight = follow.stops[follow.to];
        const end = alight
            ? serviceDayStart(run.serviceDate) + alight.time * 1000
            : departure;
        if (now.getTime() > end + AFTER_ARRIVAL_MS) return null;
        return {
            serviceDate: run.serviceDate,
            departure,
            dayOffset: Math.round(
                (Date.parse(run.date) - Date.parse(today)) / (DAY_S * 1000),
            ),
        };
    }

    const alight = follow.stops[follow.to];
    const occurrence = currentOccurrence(
        {
            weekdays: follow.weekdays,
            departureS: board.time - daysPast * DAY_S,
            runS: alight ? alight.time - board.time : null,
        },
        now,
        running,
    );
    if (!occurrence) return null;
    const serviceDate = shiftDate(occurrence.date, -daysPast);
    return {
        serviceDate,
        departure: runOn(serviceDate),
        dayOffset: occurrence.daysAhead,
    };
}

/** A follow's stops as a trip's stoptimes, for the service-day resolution. */
function asTrip(follow: LocalFollow, serviceDate: string) {
    return {
        serviceDate,
        stoptimes: follow.stops.map((s) => ({
            scheduledArrival: s.time,
            scheduledDeparture: s.time,
        })),
    };
}

/** Train numbers out on the rails now (not waiting, arrived or cancelled). */
export function runningNumbers(
    trains: TrainFeatureCollection | undefined,
): Set<string> {
    const numbers = new Set<string>();
    for (const { properties: p } of trains?.features ?? []) {
        if (
            p.activity !== "arrived" &&
            p.activity !== "cancelled" &&
            p.activity !== "beforeDeparture"
        ) {
            numbers.add(trainNumber(p.tripShortName));
        }
    }
    return numbers;
}

/** Follows to show on home, soonest first. */
export function upcoming(
    follows: readonly LocalFollow[],
    now: Date = new Date(),
    running: ReadonlySet<string> = new Set(),
): { follow: LocalFollow; run: Run }[] {
    return follows
        .flatMap((follow) => {
            const run = nextRun(
                follow,
                now,
                running.has(trainNumber(follow.tripShortName)),
            );
            return run ? [{ follow, run }] : [];
        })
        .sort((a, b) => a.run.departure - b.run.departure);
}

/**
 * Whether live `details` are the run of `follow` on `serviceDate` (a
 * commute run's resolved service date, `Run.serviceDate`). A trip is only
 * its own day's run: same trip id and OTP service date. A commute matches by
 * number and boarding station, with the live trip's service date resolved
 * at `now` (OTP dates HÉVs after midnight and train 10 off by a day).
 */
export function isRunOf(
    follow: LocalFollow,
    serviceDate: string,
    details: VehiclePositionWithDelay,
    now: Date = new Date(),
): boolean {
    if (follow.kind === "trip") {
        return (
            !!follow.tripId &&
            details.trip.gtfsId === follow.tripId &&
            details.trip.serviceDate === follow.serviceDate
        );
    }
    if (
        trainNumber(details.trip.tripShortName) !==
        trainNumber(follow.tripShortName)
    ) {
        return false;
    }
    if (effectiveServiceDate(details.trip, now) !== serviceDate) return false;
    const station = follow.stops[follow.from]?.stationId;
    return details.trip.stoptimes.some(
        (st) => stationIdOf(st.stop) === station,
    );
}

/** Header line: "2423 → Vác". */
export function followTitle(
    follow: Pick<LocalFollow, "tripShortName" | "stops">,
) {
    return trainTitle(follow.tripShortName, follow.stops.at(-1)?.name ?? null);
}

/** Trip follows are gone from the API a few days after their date. */
export function isExpired(
    follow: LocalFollow,
    now: Date = new Date(),
): boolean {
    return (
        follow.kind === "trip" &&
        !!follow.serviceDate &&
        follow.serviceDate < shiftDate(budapestDate(now), -1)
    );
}

function isStop(value: unknown): value is StopOption {
    const v = value as StopOption;
    return (
        !!v &&
        typeof v.name === "string" &&
        typeof v.time === "number" &&
        (v.stopId === null || typeof v.stopId === "string") &&
        (v.stationId === null || typeof v.stationId === "string")
    );
}

function isFollow(value: unknown): value is LocalFollow {
    const v = value as LocalFollow;
    return (
        !!v &&
        typeof v.id === "string" &&
        (v.kind === "trip" || v.kind === "commute") &&
        typeof v.tripShortName === "string" &&
        Array.isArray(v.stops) &&
        v.stops.every(isStop) &&
        Number.isInteger(v.from) &&
        Number.isInteger(v.to) &&
        v.from < v.to &&
        v.to < v.stops.length &&
        Array.isArray(v.weekdays) &&
        v.weekdays.every((d) => Number.isInteger(d) && d >= 1 && d <= 7) &&
        typeof v.delayThresholdMin === "number" &&
        typeof v.notifyPlatformChange === "boolean" &&
        (v.liveActivity === undefined || typeof v.liveActivity === "boolean")
    );
}

/** Follows from stored JSON; invalid entries are dropped. */
export function parseFollows(json: string | null | undefined): LocalFollow[] {
    try {
        const parsed: unknown = json ? JSON.parse(json) : [];
        return Array.isArray(parsed) ? parsed.filter(isFollow) : [];
    } catch {
        return [];
    }
}

/** The follow of the train in `details` (this run of it), if any. */
export function findFollowFor(
    follows: readonly LocalFollow[],
    details: VehiclePositionWithDelay,
    now: Date = new Date(),
): LocalFollow | null {
    const serviceDate = effectiveServiceDate(details.trip, now);
    return follows.find((f) => isRunOf(f, serviceDate, details, now)) ?? null;
}
