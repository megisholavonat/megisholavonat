import type { VehiclePositionWithDelay } from "@megisholavonat/api-client";
import { type DelayLevel, getDelayLevel } from "./delay";
import { minutesSinceUpdate, staleness } from "./stale";
import { MARKER } from "./tokens/tokens";

/** What a train is doing by its position and schedule (the API's `activity`). */
export type TrainActivity = NonNullable<VehiclePositionWithDelay["activity"]>;

/**
 * - running: a live delay
 * - stale: no position update for a while; its last delay, greyed with "?"
 * - idle: not running its trip (before departure, arrived, off its route);
 *   no delay, since ours is only meaningful on the way
 * - cancelled: no delay
 */
export type TrainState = "running" | "stale" | "idle" | "cancelled";

export interface TrainDisplay {
    state: TrainState;
    /** Why the train is idle or cancelled, when the API said */
    activity: TrainActivity | null;
    /** Minutes late to show, or null when there is none to show */
    delay: number | null;
    /** Colour: grey ("stale") unless running */
    level: DelayLevel | "stale";
    /** No position update for over STALE_GREY_AFTER_S */
    outdated: boolean;
    minutesSinceUpdate: number;
    /** Map marker label: "+7", the data's age "6′", or none */
    label: string;
}

/** The fields shared by the train list feature and the train details. */
export interface TrainDisplayInput {
    delay: number;
    /** Unix seconds of the last position update */
    lastUpdated: number;
    activity?: TrainActivity | null;
    /** The list's older combined flag, used only without `activity` */
    isStale?: boolean | null;
}

/**
 * The one delay and state a train shows, on the map and in its sheet alike.
 * Takes either a train list feature's properties or the train details, so
 * both agree for the same data and the same `now`.
 */
export function trainDisplay(
    train: TrainDisplayInput,
    now: Date = new Date(),
): TrainDisplay {
    const outdated = staleness(train.lastUpdated, now) !== "fresh";
    const minutes = minutesSinceUpdate(train.lastUpdated, now);
    const ageLabel = MARKER.label.stale(minutes);
    const activity = train.activity ?? null;
    const grey = {
        level: "stale" as const,
        outdated,
        minutesSinceUpdate: minutes,
    };

    if (activity === "cancelled") {
        return {
            ...grey,
            state: "cancelled",
            activity,
            delay: null,
            label: outdated ? ageLabel : "",
        };
    }
    // Without `activity`, a list flag on fresh data means not running
    const idle =
        activity != null
            ? activity !== "running"
            : !!train.isStale && !outdated;
    if (idle) {
        return {
            ...grey,
            state: "idle",
            activity,
            delay: null,
            label: outdated ? ageLabel : "",
        };
    }
    if (outdated) {
        return {
            ...grey,
            state: "stale",
            activity,
            delay: train.delay,
            label: ageLabel,
        };
    }
    const level = getDelayLevel(train.delay);
    return {
        state: "running",
        activity,
        delay: train.delay,
        level,
        outdated,
        minutesSinceUpdate: minutes,
        label: level === "onTime" ? "" : MARKER.label.delayed(train.delay),
    };
}
