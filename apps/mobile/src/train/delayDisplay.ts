import { type DelayLevel, getDelayLevel } from "@megisholavonat/core/delay";
import {
    type TrainActivity,
    type TrainDisplay,
    type TrainDisplayInput,
    trainDisplay,
} from "@megisholavonat/core/display";

// What the delay tile, chips and reason lines show. Pure, unit tested.

/** "+7", "0", "−2" (a true minus sign for early trains). */
export function signedDelay(delay: number): string {
    const minutes = Math.round(delay);
    if (minutes > 0) return `+${minutes}`;
    if (minutes < 0) return `−${Math.abs(minutes)}`;
    return "0";
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
    /** Always a number while there is a delay to show; "–" when idle */
    text: string;
    /** Minutes for the a11y label, or null */
    delay: number | null;
    level: DelayLevel | "stale";
    /** Small line under the number */
    caption: TileCaption;
}

function idleCaption(activity: TrainActivity | null): TileCaption {
    if (activity === "beforeDeparture") return { kind: "departs" };
    if (activity === "arrived") return { kind: "arrived" };
    return { kind: "not_running" };
}

/**
 * The big delay on the train sheet. A number even when on time ("+2" with a
 * small "pontos" under it); "+23?" when the data is old; "–" with what the
 * train is doing when it isn't running its trip.
 */
export function delayTile(display: TrainDisplay): DelayTileModel {
    if (display.state === "cancelled") {
        return {
            text: "–",
            delay: null,
            level: "stale",
            caption: { kind: "cancelled" },
        };
    }
    if (display.state === "idle" || display.delay === null) {
        return {
            text: "–",
            delay: null,
            level: "stale",
            caption: idleCaption(display.activity),
        };
    }
    const minutes = Math.round(display.delay);
    const text = signedDelay(minutes);
    if (display.state === "stale") {
        return {
            text: `${text}?`,
            delay: minutes,
            level: "stale",
            caption: null,
        };
    }
    const level = getDelayLevel(minutes);
    return {
        text,
        delay: minutes,
        level,
        caption:
            level !== "onTime"
                ? null
                : minutes < 0
                  ? { kind: "early" }
                  : { kind: "on_time" },
    };
}

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
 * cause of a delay: only for a train that is actually late (≥ 5 min), in
 * the colour of its level; grey when its data is old.
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
