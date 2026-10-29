import type { VehiclePositionWithDelay } from "@megisholavonat/api-client";
import {
    type DelayLevel,
    getDelayLevel,
    roundMinutes,
    signedDelay,
} from "./delay";
import { minutesSinceUpdate, staleness } from "./stale";

// How a delay reads, the same on the web and in the app.
//
// Two marks, never mixed up:
// - "?" after a delay ("+23?") means OLD DATA: no position update for over
//   STALE_GREY_AFTER_S, so this is the last delay we knew. It always comes
//   greyed, with a dashed outline; the train sheet says how old it is
//   ("Utolsó adat 6 perce: +23 perc").
// - "≈" before a time ("≈02:06") means OUR ESTIMATE of a stop time (a
//   forecast or the delay carried forward), not a time MÁV announced.
// A train with no delay at all (waiting, arrived, cancelled) shows a grey
// "–" in chips and tiles, and no label on the map.

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
    /** Map marker label: "+7", the last known "+23?", or none */
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
            label: "",
        };
    }
    // Without `activity`, a list flag on fresh data means not running
    const idle =
        activity != null
            ? activity !== "running"
            : !!train.isStale && !outdated;
    if (idle) {
        return { ...grey, state: "idle", activity, delay: null, label: "" };
    }
    if (outdated) {
        return {
            ...grey,
            state: "stale",
            activity,
            delay: train.delay,
            label: delayLabel(train.delay, true).text ?? "",
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
        label: level === "onTime" ? "" : signedDelay(train.delay),
    };
}

/** A delay as a chip or a line of text shows it. */
export interface DelayLabel {
    /**
     * "+7", the last known "+23?" for old data, "–" without a delay; null
     * when on time: each app writes its own "pontos" there
     */
    text: string | null;
    /** Colour: grey ("stale") for old data or no delay */
    level: DelayLevel | "stale";
    /** Old data: drawn with a dashed outline */
    stale: boolean;
    /** Whole minutes, or null without a delay */
    minutes: number | null;
}

/**
 * The label of a delay in chips, boards and lists: "pontos" (null text) up
 * to +5, "+7" after; old data keeps its last number with a "?" ("+23?",
 * never a confident "pontos"); no delay at all is a grey "–".
 */
export function delayLabel(delay: number | null, stale = false): DelayLabel {
    if (delay == null) {
        return { text: "–", level: "stale", stale, minutes: null };
    }
    const minutes = roundMinutes(delay);
    if (stale) {
        return {
            text: `${signedDelay(minutes)}?`,
            level: "stale",
            stale,
            minutes,
        };
    }
    const level = getDelayLevel(minutes);
    return {
        text: level === "onTime" ? null : signedDelay(minutes),
        level,
        stale,
        minutes,
    };
}

export type TileCaption =
    | { kind: "on_time" }
    | { kind: "early" }
    | { kind: "departs" }
    | { kind: "arrived" }
    | { kind: "not_running" }
    | { kind: "cancelled" }
    | null;

export interface DelayTileModel {
    /** Always a number while there is a delay to show; "–" without one */
    text: string;
    /** Whole minutes for the a11y label, or null */
    delay: number | null;
    level: DelayLevel | "stale";
    /** Old data: dashed */
    stale: boolean;
    /** Small line under the number */
    caption: TileCaption;
}

function idleCaption(activity: TrainActivity | null): TileCaption {
    if (activity === "beforeDeparture") return { kind: "departs" };
    if (activity === "arrived") return { kind: "arrived" };
    return { kind: "not_running" };
}

/**
 * The big delay of the train sheet. A number even when on time ("+2" with a
 * small "pontos" under it, "−1" with "korán"); "+23?" when the data is old;
 * "–" with what the train is doing when it isn't running its trip.
 */
export function delayTile(
    display: Pick<TrainDisplay, "state" | "delay" | "activity">,
): DelayTileModel {
    if (display.state === "cancelled") {
        return {
            text: "–",
            delay: null,
            level: "stale",
            stale: false,
            caption: { kind: "cancelled" },
        };
    }
    if (display.state === "idle" || display.delay === null) {
        return {
            text: "–",
            delay: null,
            level: "stale",
            stale: false,
            caption: idleCaption(display.activity),
        };
    }
    const minutes = roundMinutes(display.delay);
    if (display.state === "stale") {
        return {
            text: `${signedDelay(minutes)}?`,
            delay: minutes,
            level: "stale",
            stale: true,
            caption: null,
        };
    }
    const level = getDelayLevel(minutes);
    return {
        text: signedDelay(minutes),
        delay: minutes,
        level,
        stale: false,
        caption:
            level !== "onTime"
                ? null
                : minutes < 0
                  ? { kind: "early" }
                  : { kind: "on_time" },
    };
}

/**
 * What the train sheet says about old data, to explain the "?": how long ago
 * the last update came and the delay it had ("Utolsó adat 6 perce: +23
 * perc"); `delay` is null when the train had none to tell (idle or
 * cancelled), and `onTime` when it was within the on-time band. Null while
 * the data is fresh.
 */
export function staleNote(
    display: TrainDisplay,
): { minutes: number; delay: string | null; onTime: boolean } | null {
    if (!display.outdated) return null;
    if (display.state !== "stale" || display.delay === null) {
        return {
            minutes: display.minutesSinceUpdate,
            delay: null,
            onTime: false,
        };
    }
    return {
        minutes: display.minutesSinceUpdate,
        delay: signedDelay(display.delay),
        onTime: getDelayLevel(display.delay) === "onTime",
    };
}
