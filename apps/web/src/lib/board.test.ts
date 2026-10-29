import { describe, expect, it } from "vitest";
import { rowTime } from "./board";

const at = 1_793_243_160; // 04:06

describe("rowTime", () => {
    it("shows a late train's expected time, the scheduled one struck", () => {
        expect(
            rowTime({ scheduledTime: at }, { delay: 11, stale: false }),
        ).toEqual({
            time: at + 11 * 60,
            late: true,
        });
    });

    it("keeps the scheduled time within the on-time band", () => {
        expect(
            rowTime({ scheduledTime: at }, { delay: 4, stale: false }),
        ).toEqual({
            time: at,
            late: false,
        });
    });

    it("never moves a stale, cancelled or delay-less row", () => {
        expect(
            rowTime({ scheduledTime: at }, { delay: 30, stale: true }).late,
        ).toBe(false);
        expect(
            rowTime(
                { scheduledTime: at, canceled: true },
                { delay: 30, stale: false },
            ).late,
        ).toBe(false);
        expect(rowTime({ scheduledTime: at }, null)).toEqual({
            time: at,
            late: false,
        });
    });

    it("sorts rows into the order of the times they show", () => {
        // The QA board: 12:24 +11, 12:31 +6 and 12:32, 12:36 on time
        const min = (h: number, m: number) => (h * 60 + m) * 60;
        const rows = [
            { scheduledTime: min(12, 32), shown: null },
            { scheduledTime: min(12, 24), shown: { delay: 11, stale: false } },
            { scheduledTime: min(12, 31), shown: { delay: 6, stale: false } },
            { scheduledTime: min(12, 36), shown: null },
        ];
        const times = rows
            .map((r) => rowTime(r, r.shown).time)
            .sort((a, b) => a - b);
        expect(times).toEqual([
            min(12, 32),
            min(12, 35),
            min(12, 36),
            min(12, 37),
        ]);
    });
});
