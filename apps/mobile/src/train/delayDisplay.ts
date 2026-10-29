import { type DelayLevel, getDelayLevel } from "@megisholavonat/core/delay";
import {
    type TrainDisplay,
    type TrainDisplayInput,
    trainDisplay,
} from "@megisholavonat/core/display";

// What the delay tile, chips and reason lines show, on top of core's
// `trainDisplay` / `delayTile` / `delayLabel`. Pure, unit tested.

/**
 * A train standing at a stop leaves on time at the earliest, so it is never
 * "early" there; older APIs could report a long dwell as minutes early.
 */
export function notEarlyWhileStanding(
    display: TrainDisplay,
    standing: boolean,
): TrainDisplay {
    return standing && display.delay !== null && display.delay < 0
        ? { ...display, delay: 0 }
        : display;
}

/** A train as the map feed or its details give it, with the API's dwell. */
export type ShownTrainInput = TrainDisplayInput & {
    /** The stop the API says the train stands at, if any */
    dwellStopIndex?: number | null;
};

/**
 * The state and delay a train shows, the same for its map marker and its
 * sheet: core `trainDisplay`, never early while the API says it stands at
 * a stop (`dwellStopIndex`). A train merely at 0 km/h (a signal, open line)
 * keeps its early minutes, as on the web.
 */
export function shownDisplay(
    train: ShownTrainInput,
    now: Date = new Date(),
): TrainDisplay {
    return notEarlyWhileStanding(
        trainDisplay(train, now),
        train.dwellStopIndex != null,
    );
}

/**
 * The tint of a delay reason, or null when it shouldn't be shown as the
 * cause of a delay: only for a train that is actually late (over +5, past
 * the on-time band), in the colour of its level; grey when its data is old.
 */
export function reasonTone(
    delay: number | null,
    stale = false,
): DelayLevel | "stale" | null {
    if (delay === null) return null;
    const level = getDelayLevel(delay);
    if (level === "onTime") return null;
    return stale ? "stale" : level;
}
