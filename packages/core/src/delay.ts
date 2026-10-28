import { ORANGE_THRESHOLD, RED_THRESHOLD, YELLOW_THRESHOLD } from "./constants";

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

/** Map marker / legend colour for each delay level. */
export const DELAY_COLORS = {
    onTime: "#4AD94A", // green
    slight: "#E4DE3A", // yellow
    moderate: "#DF9227", // orange
    severe: "#D9564A", // red
} as const satisfies Record<DelayLevel, string>;
