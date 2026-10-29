import { type DelayLevel, getDelayLevel } from "@megisholavonat/core/delay";
import type { TrainActivity, TrainDisplay } from "./trainState";

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
    const text = signedDelay(display.delay);
    if (display.state === "stale") {
        return {
            text: `${text}?`,
            delay: display.delay,
            level: "stale",
            caption: null,
        };
    }
    const level = getDelayLevel(display.delay);
    return {
        text,
        delay: display.delay,
        level,
        caption: level === "onTime" ? { kind: "on_time" } : null,
    };
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
