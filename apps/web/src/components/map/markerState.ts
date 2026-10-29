import type { TrainFeatureProperties } from "@megisholavonat/api-client";
import {
    STALE_GREY_AFTER_S,
    STALE_HIDE_AFTER_S,
} from "@megisholavonat/core/constants";
import { getDelayLevel } from "@megisholavonat/core/delay";
import { MARKER } from "@megisholavonat/core/tokens";
import type { MarkerLevel } from "./markerImages";

/**
 * - live: running, with a delay
 * - stale: no position update for over 5 min; hollow, dashed, "6′"
 * - inactive: waiting to depart, arrived or off its route; a grey dot with
 *   no delay, since ours only means something on the way
 * - hidden: no update for over 30 min
 */
export type MarkerState = "live" | "stale" | "inactive" | "hidden";

export interface MarkerDisplay {
    state: MarkerState;
    level: MarkerLevel;
    /** "+7", the data's age "6′", or nothing */
    label: string;
    minutesSinceUpdate: number;
}

/**
 * How a train looks on the map. The one place that reads the feed's state:
 * today's `isStale` is "no update for 5 min OR not running its trip", so a
 * fresh `lastUpdated` tells an inactive train from a stale one. Swap this for
 * the API's explicit state when it lands.
 */
export function markerDisplay(
    props: Pick<TrainFeatureProperties, "isStale" | "lastUpdated" | "delay">,
    nowS: number,
): MarkerDisplay {
    const age = Math.max(0, nowS - props.lastUpdated);
    const minutesSinceUpdate = Math.floor(age / 60);
    if (age > STALE_HIDE_AFTER_S) {
        return {
            state: "hidden",
            level: "stale",
            label: "",
            minutesSinceUpdate,
        };
    }
    if (age > STALE_GREY_AFTER_S) {
        return {
            state: "stale",
            level: "stale",
            label: MARKER.label.stale(minutesSinceUpdate),
            minutesSinceUpdate,
        };
    }
    if (props.isStale) {
        return {
            state: "inactive",
            level: "inactive",
            label: "",
            minutesSinceUpdate,
        };
    }
    const level = getDelayLevel(props.delay);
    return {
        state: "live",
        level,
        label: level === "onTime" ? "" : MARKER.label.delayed(props.delay),
        minutesSinceUpdate,
    };
}
