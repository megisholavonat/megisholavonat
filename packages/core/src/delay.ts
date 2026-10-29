import { ORANGE_THRESHOLD, RED_THRESHOLD, YELLOW_THRESHOLD } from "./constants";
import { DELAY_SCALE, STALE_COLORS } from "./tokens/tokens";

export type DelayLevel = "onTime" | "slight" | "moderate" | "severe";

/** Classifies a delay (in minutes) using the shared thresholds. */
export function getDelayLevel(delayMinutes: number): DelayLevel {
    if (delayMinutes >= RED_THRESHOLD) {
        return "severe";
    } else if (delayMinutes >= ORANGE_THRESHOLD) {
        return "moderate";
    } else if (delayMinutes >= YELLOW_THRESHOLD) {
        return "slight";
    }

    return "onTime";
}

/** Map marker / legend colour for each delay level (light fills of `DELAY_SCALE`). */
export const DELAY_COLORS = {
    onTime: DELAY_SCALE.light.onTime.fill,
    slight: DELAY_SCALE.light.slight.fill,
    moderate: DELAY_SCALE.light.moderate.fill,
    severe: DELAY_SCALE.light.severe.fill,
} as const satisfies Record<DelayLevel, string>;

/** Map marker / legend colour for stale or inactive trains ("no data"). */
export const NO_DATA_COLOR = STALE_COLORS.light.fill;
