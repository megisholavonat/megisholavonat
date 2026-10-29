import {
    type TrainDisplayInput,
    trainDisplay,
} from "@megisholavonat/core/display";
import { describe, expect, it } from "vitest";
import {
    delayTile,
    notEarlyWhileStanding,
    reasonTone,
    signedDelay,
} from "./delayDisplay";

const now = new Date("2026-08-14T08:00:00Z");
const ago = (s: number) => now.getTime() / 1000 - s;

describe("signedDelay", () => {
    it("signs late and early trains, with a true minus", () => {
        expect(signedDelay(7)).toBe("+7");
        expect(signedDelay(0)).toBe("0");
        expect(signedDelay(-2)).toBe("−2");
        expect(signedDelay(3.6)).toBe("+4");
        expect(signedDelay(-0.4)).toBe("0");
    });
});

describe("delayTile", () => {
    const tile = (delay: number, input: Partial<TrainDisplayInput> = {}) =>
        delayTile(trainDisplay({ delay, lastUpdated: ago(30), ...input }, now));

    it("always shows a number, with 'on time' as a caption below 5 min", () => {
        expect(tile(3)).toEqual({
            text: "+3",
            delay: 3,
            level: "onTime",
            caption: { kind: "on_time" },
        });
        expect(tile(0).text).toBe("0");
        expect(tile(-2)).toMatchObject({
            text: "−2",
            caption: { kind: "early" },
        });
    });

    it("rounds the API's fractional minutes", () => {
        expect(tile(22.6)).toMatchObject({ text: "+23", delay: 23 });
    });

    it("shows late trains by level without a caption", () => {
        expect(tile(5)).toMatchObject({
            text: "+5",
            level: "slight",
            caption: null,
        });
        expect(tile(23)).toMatchObject({ text: "+23", level: "moderate" });
        expect(tile(75)).toMatchObject({ text: "+75", level: "severe" });
    });

    it("marks old data's delay uncertain and grey", () => {
        expect(tile(23, { lastUpdated: ago(600) })).toEqual({
            text: "+23?",
            delay: 23,
            level: "stale",
            caption: null,
        });
    });

    it("shows no delay for idle trains, but what they are doing", () => {
        expect(tile(109, { isStale: true })).toEqual({
            text: "–",
            delay: null,
            level: "stale",
            caption: { kind: "not_running" },
        });
        expect(tile(40, { activity: "beforeDeparture" }).caption).toEqual({
            kind: "departs",
        });
        expect(tile(40, { activity: "arrived" }).caption).toEqual({
            kind: "arrived",
        });
        expect(tile(40, { activity: "cancelled" }).caption).toEqual({
            kind: "cancelled",
        });
    });
});

describe("reasonTone", () => {
    it("shows a reason only for a late train, tinted by its level", () => {
        expect(reasonTone(null)).toBeNull();
        expect(reasonTone(0)).toBeNull();
        expect(reasonTone(4)).toBeNull();
        expect(reasonTone(-3)).toBeNull();
        expect(reasonTone(5)).toBe("slight");
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
            caption: { kind: "on_time" },
        });
    });

    it("keeps a moving train's early minutes and any late ones", () => {
        expect(notEarlyWhileStanding(display(-2), false).delay).toBe(-2);
        expect(notEarlyWhileStanding(display(7), true).delay).toBe(7);
    });
});
