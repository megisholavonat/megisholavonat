import type { BoardEntry } from "@megisholavonat/api-client";
import { getDelayLevel } from "@megisholavonat/core/delay";

/** A board row's delay: from the map's train when it is there */
export interface RowDelay {
    delay: number;
    stale: boolean;
}

/**
 * The time a row shows: the expected time when its live delay is late
 * (6+ min, the scheduled time struck through beside it), else the
 * scheduled time, as "pontos" means. The board is sorted by this time, so
 * its rows always read in order.
 */
export function rowTime(
    entry: Pick<BoardEntry, "scheduledTime" | "canceled">,
    shown: RowDelay | null,
): { time: number; late: boolean } {
    const late =
        !!shown &&
        !shown.stale &&
        !entry.canceled &&
        getDelayLevel(shown.delay) !== "onTime";
    return {
        time:
            late && shown
                ? entry.scheduledTime + shown.delay * 60
                : entry.scheduledTime,
        late,
    };
}
