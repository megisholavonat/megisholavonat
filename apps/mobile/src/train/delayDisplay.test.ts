import { delayTile, trainDisplay } from "@megisholavonat/core/display";
import { describe, expect, it } from "vitest";
import { notEarlyWhileStanding, reasonTone } from "./delayDisplay";

const now = new Date("2026-08-14T08:00:00Z");
const ago = (s: number) => now.getTime() / 1000 - s;

describe("reasonTone", () => {
    it("shows a reason only for a late train, tinted by its level", () => {
        expect(reasonTone(null)).toBeNull();
        expect(reasonTone(0)).toBeNull();
        expect(reasonTone(4)).toBeNull();
        // +5 is still on time
        expect(reasonTone(5)).toBeNull();
        expect(reasonTone(-3)).toBeNull();
        expect(reasonTone(6)).toBe("slight");
        expect(reasonTone(23)).toBe("moderate");
        expect(reasonTone(61)).toBe("severe");
        expect(reasonTone(23, true)).toBe("stale");
    });
});

describe("notEarlyWhileStanding", () => {
    const display = (delay: number) =>
        trainDisplay({ delay, lastUpdated: ago(30) }, now);

    it("never shows a standing train as early", () => {
        expect(delayTile(notEarlyWhileStanding(display(-18), true))).toEqual({
            text: "0",
            delay: 0,
            level: "onTime",
            stale: false,
            caption: { kind: "on_time" },
        });
    });

    it("keeps a moving train's early minutes and any late ones", () => {
        expect(notEarlyWhileStanding(display(-2), false).delay).toBe(-2);
        expect(notEarlyWhileStanding(display(7), true).delay).toBe(7);
    });
});
