import type {
    TrainFeatureCollection,
    TrainFeatureProperties,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";
import { type DelayLevel, getDelayLevel } from "@megisholavonat/core/delay";
import { minutesSinceUpdate, staleness } from "@megisholavonat/core/stale";
import { beforeDeparture } from "./trainData";

// One delay and state per train, for the marker, the sheet and every row.
//
// Local adapter over today's API fields (`isStale` = stale or not active,
// plus the age of `lastUpdated`). It mirrors `trainDisplay` from
// `@megisholavonat/core/display` (branch fix/train-state-consistency), so
// switching to it once the API sends `activity` is one import change.

/** What a train is doing by its position and schedule (the API's `activity`). */
export type TrainActivity =
    | "running"
    | "beforeDeparture"
    | "arrived"
    | "offRoute"
    | "cancelled";

/**
 * - running: a live delay
 * - stale: no position update for a while; its last delay, greyed with "?"
 * - idle: not running its trip (before departure, arrived, off its route)
 * - cancelled: no delay
 */
export type TrainState = "running" | "stale" | "idle" | "cancelled";

export interface TrainDisplay {
    state: TrainState;
    /** Why the train is idle or cancelled, when known */
    activity: TrainActivity | null;
    /** Minutes late to show, or null when there is none to show */
    delay: number | null;
    /** Colour: grey ("stale") unless running */
    level: DelayLevel | "stale";
    /** No position update for over STALE_GREY_AFTER_S */
    outdated: boolean;
    minutesSinceUpdate: number;
}

export interface TrainDisplayInput {
    delay: number;
    /** Unix seconds of the last position update */
    lastUpdated: number;
    activity?: TrainActivity | null;
    /** The list's combined flag (stale or not active), used without `activity` */
    isStale?: boolean | null;
}

export function trainDisplay(
    train: TrainDisplayInput,
    now: Date = new Date(),
): TrainDisplay {
    const outdated = staleness(train.lastUpdated, now) !== "fresh";
    const minutes = minutesSinceUpdate(train.lastUpdated, now);
    const activity = train.activity ?? null;
    const grey = {
        level: "stale" as const,
        outdated,
        minutesSinceUpdate: minutes,
    };
    if (activity === "cancelled") {
        return { ...grey, state: "cancelled", activity, delay: null };
    }
    // Without a known activity, the list's flag on fresh data means idle
    const idle =
        activity != null && activity !== "running"
            ? true
            : activity === "running"
              ? false
              : !!train.isStale && !outdated;
    if (idle) return { ...grey, state: "idle", activity, delay: null };
    if (outdated) {
        return {
            ...grey,
            state: "stale",
            activity,
            delay: Math.round(train.delay),
        };
    }
    const delay = Math.round(train.delay);
    return {
        state: "running",
        activity,
        delay,
        level: getDelayLevel(delay),
        outdated,
        minutesSinceUpdate: minutes,
    };
}

/**
 * Best guess of the activity from the details alone: before its first
 * departure, or past its last stop. Null when it looks under way, since only
 * the API knows whether it is off its route.
 */
export function localActivity(
    details: VehiclePositionWithDelay,
    now: Date = new Date(),
): TrainActivity | null {
    const count = details.trip.stoptimes.length;
    if (count === 0) return null;
    const { lastStopIndex, nextStopIndex, progress } = details.vehicleProgress;
    if (
        lastStopIndex === count - 1 &&
        (progress >= 1 || nextStopIndex === lastStopIndex)
    ) {
        return "arrived";
    }
    if (beforeDeparture(details, now)) return "beforeDeparture";
    return null;
}

/**
 * The input for the train sheet: the details with the list's flag. The
 * list's flag counts as "not active" only while its own data is fresh (else
 * it may just mean old data, and the details can be newer). The details'
 * own guess only marks the train idle when the list agrees, or when the
 * list doesn't know the train.
 */
export function sheetInput(
    details: VehiclePositionWithDelay | undefined,
    feature:
        | { delay: number; lastUpdated: number; isStale?: boolean }
        | undefined,
    now: Date = new Date(),
): TrainDisplayInput | null {
    const listInactive = feature
        ? feature.isStale === true &&
          staleness(feature.lastUpdated, now) === "fresh"
        : null;
    if (details) {
        const guess = localActivity(details, now);
        return {
            delay: details.delay,
            lastUpdated: details.lastUpdated,
            isStale: listInactive,
            activity: guess && listInactive !== false ? guess : null,
        };
    }
    return feature
        ? {
              delay: feature.delay,
              lastUpdated: feature.lastUpdated,
              isStale: feature.isStale ?? null,
          }
        : null;
}

/**
 * The map feed with one train brought up to date from its details, when
 * those are newer: the open train's marker then shows what its sheet shows
 * (the feed polls every minute, the details every 15 s). The list's "not
 * active" flag is kept only if it came from fresh data. Returns the same
 * object when nothing changes.
 */
export function patchFeed(
    feed: TrainFeatureCollection | undefined,
    details: VehiclePositionWithDelay,
    now: Date = new Date(),
): TrainFeatureCollection | undefined {
    if (!feed) return feed;
    const index = feed.features.findIndex(
        (f) => f.properties.vehicleId === details.vehicleId,
    );
    const feature = feed.features[index];
    if (!feature || feature.properties.lastUpdated >= details.lastUpdated) {
        return feed;
    }
    const p = feature.properties;
    const properties: TrainFeatureProperties = {
        ...p,
        lat: details.lat,
        lon: details.lon,
        heading: details.heading ?? p.heading,
        speed: details.speed ?? p.speed,
        delay: details.delay,
        lastUpdated: details.lastUpdated,
        isStale:
            p.isStale === true && staleness(p.lastUpdated, now) === "fresh",
    };
    const features = [...feed.features];
    features[index] = {
        ...feature,
        geometry: {
            ...feature.geometry,
            coordinates: [details.lon, details.lat],
        },
        properties,
    };
    return { ...feed, features };
}
