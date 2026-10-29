import { STALE_HIDE_AFTER_S } from "@megisholavonat/core/constants";
import {
    type TrainDisplayInput,
    trainDisplay,
} from "@megisholavonat/core/display";
import type { MarkerLevel } from "./markerImages";

/**
 * - live: running, with a delay
 * - stale: no position update for over 5 min; hollow, dashed, its last
 *   delay with a "?" ("+23?")
 * - inactive: waiting to depart, arrived, off its route or cancelled; a grey
 *   dot with no delay, since ours only means something on the way
 * - hidden: no update for over 30 min
 */
export type MarkerState = "live" | "stale" | "inactive" | "hidden";

export interface MarkerDisplay {
    state: MarkerState;
    level: MarkerLevel;
    /** "+7", the last known "+23?", or nothing */
    label: string;
    /** The delay the train sheet shows too, or null for none */
    delay: number | null;
    minutesSinceUpdate: number;
}

/**
 * How a train looks on the map: core's trainDisplay, the same delay and
 * state as its sheet, mapped onto the marker's shapes.
 */
export function markerDisplay(
    props: TrainDisplayInput,
    nowS: number,
): MarkerDisplay {
    const display = trainDisplay(props, new Date(nowS * 1000));
    const { label, delay, minutesSinceUpdate } = display;
    const base = { label, delay, minutesSinceUpdate };
    if (nowS - props.lastUpdated > STALE_HIDE_AFTER_S) {
        return { ...base, state: "hidden", level: "stale", label: "" };
    }
    if (display.state === "running") {
        return { ...base, state: "live", level: display.level };
    }
    if (display.outdated) {
        return { ...base, state: "stale", level: "stale" };
    }
    return { ...base, state: "inactive", level: "inactive" };
}
