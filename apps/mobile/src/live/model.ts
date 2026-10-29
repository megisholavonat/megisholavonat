import type {
    LiveActivitySetup,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";
import { serviceDayStart } from "@megisholavonat/core/time";
import type {
    ActivityAttributes,
    ActivityState,
} from "../../modules/live-activity";
import type { LiveFollow } from "../follow/live";
import {
    followTitle,
    type LocalFollow,
    type Run,
    stationIdOf,
    trainNumber,
} from "../follow/model";
import { stopRows } from "../train/trainData";

// What the Live Activity and the commute widget show, from the follows and
// the live data. Pure, unit tested under Node. The content state matches the
// API's pushes (apps/api push_alerts.py `live_activity_content`), so a local
// update and a push never disagree.

/** A Live Activity starts at most this long before the departure */
export const START_WINDOW_MS = 3 * 3600_000;
/**
 * Where the API starts activities by push (iOS 17.2+, from 40 minutes before
 * departure by default), the app starts one itself only this close to it:
 * the push was lost, or push-to-start is off on the API
 */
export const LOCAL_FALLBACK_MS = 20 * 60_000;
/** ... and ends this long after the scheduled arrival at the latest */
const END_AFTER_ARRIVAL_MS = 2 * 3600_000;
/** An activity not updated for this long shows as stale */
export const STALE_MS = 10 * 60_000;
/** Progress and times alone are sent at most this often */
const MIN_UPDATE_INTERVAL_MS = 60_000;
/** Changes sent at once (as in the API) */
const MEANINGFUL: (keyof ActivityState)[] = [
    "delayMin",
    "nextStop",
    "platform",
    "platformSure",
    "departed",
];
/** Runs written for the widget */
const WIDGET_RUNS = 4;

/** `1:005501024_14` -> `14`: the platform a platform-level stop stands for. */
export function platformOfStop(stopId: string | null): string | null {
    if (!stopId) return null;
    const local = stopId.split(":").slice(1).join(":") || stopId;
    const at = local.indexOf("_");
    return at < 0 ? null : local.slice(at + 1) || null;
}

/** The line as a text badge: "S70", else the category, else the number. */
export function badgeOf(
    follow: Pick<LocalFollow, "routeShortName" | "tripShortName">,
): string {
    return (
        follow.routeShortName?.trim() ||
        trainNumber(follow.tripShortName).toLocaleUpperCase()
    );
}

/** Opens the followed train (src/app/followed/[id].tsx). */
export function followLink(followId: string): string {
    return `megisholavonat://followed/${encodeURIComponent(followId)}`;
}

type Shown = Pick<
    LocalFollow,
    "tripShortName" | "routeShortName" | "stops" | "from" | "to"
>;

function titleOf(follow: Shown): string {
    const { number, destination } = followTitle(follow);
    return destination ? `${number} → ${destination}` : number;
}

export function activityAttributes(follow: LocalFollow): ActivityAttributes {
    return {
        followId: follow.id,
        badge: badgeOf(follow),
        title: titleOf(follow),
        from: follow.stops[follow.from]?.name ?? "",
        to: follow.stops[follow.to]?.name ?? "",
        url: followLink(follow.id),
    };
}

/**
 * What the API needs to start the follow's Live Activity by push (iOS
 * 17.2+): the same attributes, and the timetable it shows until the train
 * is live.
 */
export function liveActivitySetup(follow: Shown): LiveActivitySetup | null {
    const board = follow.stops[follow.from];
    const alight = follow.stops[follow.to];
    if (!board?.name || !alight?.name) return null;
    return {
        badge: badgeOf(follow).slice(0, 16),
        title: titleOf(follow).slice(0, 128),
        fromName: board.name.slice(0, 128),
        toName: alight.name.slice(0, 128),
        departureS: board.time,
        arrivalS: alight.time,
        platform: platformOfStop(board.stopId)?.slice(0, 16) ?? null,
    };
}

/**
 * Whether the app starts a due activity itself: always before iOS 17.2,
 * else only as a fallback close to departure (LOCAL_FALLBACK_MS), so it
 * doesn't race the API's start.
 */
export function startsLocally(
    run: Run,
    now: Date,
    pushToStart: boolean,
): boolean {
    return !pushToStart || run.departure - now.getTime() <= LOCAL_FALLBACK_MS;
}

/** Before the train is on the map: the timetable at the boarding stop. */
export function scheduledState(follow: LocalFollow, run: Run): ActivityState {
    const board = follow.stops[follow.from];
    const alight = follow.stops[follow.to];
    const dayStart = serviceDayStart(run.serviceDate) / 1000;
    return {
        delayMin: null,
        nextStop: board?.name ?? null,
        nextStopAt: Math.round(run.departure / 1000),
        platform: platformOfStop(board?.stopId ?? null),
        platformSure: true,
        eta: alight ? dayStart + alight.time : null,
        progress: 0,
        departed: false,
    };
}

/**
 * The live state of `follow` on its train: the boarding stop until the
 * train leaves it, then the next stop; times are the timetable plus the
 * current delay. Null when the train doesn't call at the follow's stops.
 */
export function liveState(
    follow: LocalFollow,
    details: VehiclePositionWithDelay,
    now: Date,
): (ActivityState & { finished: boolean }) | null {
    const stoptimes = details.trip.stoptimes;
    const stationOf = (i: number) => follow.stops[i]?.stationId ?? null;
    const board = stoptimes.findIndex(
        (st) => stationIdOf(st.stop) === stationOf(follow.from),
    );
    if (board < 0) return null;
    let alight = stoptimes.findIndex(
        (st, i) => i > board && stationIdOf(st.stop) === stationOf(follow.to),
    );
    if (alight < 0) alight = stoptimes.length - 1;

    const rows = stopRows(details);
    const departed = rows[board]?.state === "passed";
    const finished = rows[alight]?.state === "passed";
    const next = rows.findIndex((r) => r.state === "next");
    const focus = !departed
        ? board
        : next > board
          ? Math.min(next, alight)
          : alight;

    const delayMin = Math.max(0, Math.round(details.delay));
    const dayStart = serviceDayStart(details.trip.serviceDate) / 1000;
    const at = (seconds: number) => dayStart + seconds + delayMin * 60;
    const departure = at(stoptimes[board]?.scheduledDeparture ?? 0);
    const eta = at(stoptimes[alight]?.scheduledArrival ?? 0);
    const focusStop = stoptimes[focus];
    let progress = 0;
    if (finished) progress = 1;
    else if (departed && eta > departure) {
        const ratio = (now.getTime() / 1000 - departure) / (eta - departure);
        progress = Math.round(Math.min(Math.max(ratio, 0), 1) * 100) / 100;
    }
    return {
        delayMin,
        nextStop: focusStop?.stop.name ?? null,
        nextStopAt: focusStop
            ? at(
                  departed
                      ? focusStop.scheduledArrival
                      : focusStop.scheduledDeparture,
              )
            : null,
        platform: focusStop?.stop.platformCode ?? null,
        platformSure: true,
        eta,
        progress,
        departed,
        finished,
    };
}

/** The state to show for a follow's run: live once the train is known. */
export function activityState(
    follow: LocalFollow,
    run: Run,
    live: LiveFollow | undefined,
    now: Date,
): ActivityState & { finished: boolean } {
    const fromLive = live ? liveState(follow, live.details, now) : null;
    return fromLive ?? { ...scheduledState(follow, run), finished: false };
}

/**
 * Whether `follow` should have a Live Activity now: turned on, its run is
 * today, departure within START_WINDOW_MS, not yet arrived.
 */
export function wantsActivity(
    follow: LocalFollow,
    run: Run | null | undefined,
    now: Date,
    finished = false,
): boolean {
    if (!follow.liveActivity || !run || run.dayOffset !== 0 || finished) {
        return false;
    }
    const alight = follow.stops[follow.to];
    const arrival = alight
        ? serviceDayStart(run.serviceDate) + alight.time * 1000
        : run.departure;
    const t = now.getTime();
    return (
        t >= run.departure - START_WINDOW_MS &&
        t <= arrival + END_AFTER_ARRIVAL_MS
    );
}

/** On by default for a single trip leaving soon. */
export function liveActivityDefault(
    weekdays: readonly number[],
    departure: number | null,
    now: Date,
): boolean {
    return (
        weekdays.length === 0 &&
        departure !== null &&
        departure - now.getTime() <= START_WINDOW_MS
    );
}

/** Whether a local update is due (same rule as the API's pushes). */
export function updateDue(
    next: ActivityState,
    last: ActivityState | undefined,
    lastAt: number | undefined,
    now: number,
): boolean {
    if (!last || lastAt === undefined) return true;
    if (JSON.stringify(next) === JSON.stringify(last)) return false;
    if (MEANINGFUL.some((k) => next[k] !== last[k])) return true;
    return now - lastAt >= MIN_UPDATE_INTERVAL_MS;
}

/** CommuteRun in targets/widgets/CommuteWidget.swift */
export interface WidgetRun {
    followId: string;
    badge: string;
    title: string;
    station: string;
    departure: number;
    delayMin: number | null;
    platform: string | null;
    platformSure: boolean;
    url: string;
}

/** The next followed runs for the widget, soonest first. */
export function widgetRuns(
    items: readonly { follow: LocalFollow; run: Run; live?: LiveFollow }[],
): WidgetRun[] {
    return items.slice(0, WIDGET_RUNS).map(({ follow, run, live }) => {
        const board = follow.stops[follow.from];
        const attributes = activityAttributes(follow);
        const livePlatform = live?.board?.platform ?? null;
        const delay = live ? (live.board?.delay ?? live.details.delay) : null;
        return {
            followId: follow.id,
            badge: attributes.badge,
            title: attributes.title,
            station: board?.name ?? "",
            departure: Math.round(run.departure / 1000),
            delayMin: delay === null ? null : Math.max(0, Math.round(delay)),
            platform: livePlatform ?? platformOfStop(board?.stopId ?? null),
            platformSure: true,
            url: attributes.url,
        };
    });
}
