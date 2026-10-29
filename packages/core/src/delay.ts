import { ON_TIME_MAX_MIN, ORANGE_THRESHOLD, RED_THRESHOLD } from "./constants";
import { DELAY_SCALE, STALE_COLORS } from "./tokens/tokens";

export type DelayLevel = "onTime" | "slight" | "moderate" | "severe";

/**
 * Whole minutes of a delay, rounded half up (`floor(x + 0.5)`): 2.5 → 3,
 * 2.49 → 2, −2.5 → −2. Every client shows and classifies a delay by this
 * number, so the "+5" a train shows is the 5 its colour is picked by. The
 * API must round the same way when it turns seconds into minutes (half up,
 * not Python's banker's `round`, which makes 150 s 2 minutes).
 */
export function roundMinutes(minutes: number): number {
    return Math.round(minutes);
}

/** Whole minutes of a delay given in seconds, half up: 150 s → 3, 149 s → 2. */
export function secondsToMinutes(seconds: number): number {
    return roundMinutes(seconds / 60);
}

/**
 * Classifies a delay (in minutes) by its whole minutes: on time up to and
 * including ON_TIME_MAX_MIN (+5 is "pontos"), yellow from 6, orange from 15,
 * red from 60.
 */
export function getDelayLevel(delayMinutes: number): DelayLevel {
    const minutes = roundMinutes(delayMinutes);
    if (minutes >= RED_THRESHOLD) return "severe";
    if (minutes >= ORANGE_THRESHOLD) return "moderate";
    if (minutes > ON_TIME_MAX_MIN) return "slight";
    return "onTime";
}

/** The minute each level starts from, for legends: 0, 6, 15, 60. */
export const LEVEL_FROM_MIN = {
    onTime: 0,
    slight: ON_TIME_MAX_MIN + 1,
    moderate: ORANGE_THRESHOLD,
    severe: RED_THRESHOLD,
} as const satisfies Record<DelayLevel, number>;

/** Signed whole minutes: "+23", "0", "−2" (a true minus sign when early). */
export function signedDelay(delay: number): string {
    const minutes = roundMinutes(delay);
    if (minutes > 0) return `+${minutes}`;
    if (minutes < 0) return `−${-minutes}`;
    return "0";
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
