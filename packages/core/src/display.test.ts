import type {
    TrainFeatureProperties,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";
import { describe, expect, it } from "vitest";
import {
    delayLabel,
    delayTile,
    staleNote,
    type TrainDisplayInput,
    trainDisplay,
} from "./display";

const now = new Date("2026-08-14T08:00:00Z");
const ago = (seconds: number) => Math.floor(now.getTime() / 1000) - seconds;

function train(input: Partial<TrainDisplayInput> = {}): TrainDisplayInput {
    return { delay: 23, lastUpdated: ago(30), activity: "running", ...input };
}

describe("trainDisplay", () => {
    it("shows a running train's live delay", () => {
        expect(trainDisplay(train(), now)).toMatchObject({
            state: "running",
            delay: 23,
            level: "moderate",
            outdated: false,
            label: "+23",
        });
    });

    it("labels nothing for an on-time running train, +5 included", () => {
        const display = trainDisplay(train({ delay: 4 }), now);
        expect(display).toMatchObject({ level: "onTime", delay: 4, label: "" });
        expect(trainDisplay(train({ delay: 5.4 }), now)).toMatchObject({
            level: "onTime",
            label: "",
        });
        expect(trainDisplay(train({ delay: 6 }), now)).toMatchObject({
            level: "slight",
            label: "+6",
        });
    });

    it("keeps a stale train's last delay, greyed, with a '?'", () => {
        expect(trainDisplay(train({ lastUpdated: ago(7 * 60) }), now)).toEqual({
            state: "stale",
            activity: "running",
            delay: 23,
            level: "stale",
            outdated: true,
            minutesSinceUpdate: 7,
            label: "+23?",
        });
    });

    it("turns stale only after 5 minutes", () => {
        expect(trainDisplay(train({ lastUpdated: ago(300) }), now).state).toBe(
            "running",
        );
        expect(trainDisplay(train({ lastUpdated: ago(301) }), now).state).toBe(
            "stale",
        );
    });

    it.each([
        "beforeDeparture",
        "arrived",
        "offRoute",
    ] as const)("shows no delay while idle (%s)", (activity) => {
        // A train standing at its terminus keeps "losing" time on our clock
        const display = trainDisplay(train({ activity, delay: 111 }), now);
        expect(display).toEqual({
            state: "idle",
            activity,
            delay: null,
            level: "stale",
            outdated: false,
            minutesSinceUpdate: 0,
            label: "",
        });
    });

    it("labels no delay on an idle train with old data", () => {
        const display = trainDisplay(
            train({ activity: "arrived", lastUpdated: ago(9 * 60) }),
            now,
        );
        expect(display).toMatchObject({
            state: "idle",
            delay: null,
            outdated: true,
            label: "",
        });
    });

    it("shows no delay for a cancelled train", () => {
        expect(trainDisplay(train({ activity: "cancelled" }), now)).toEqual({
            state: "cancelled",
            activity: "cancelled",
            delay: null,
            level: "stale",
            outdated: false,
            minutesSinceUpdate: 0,
            label: "",
        });
    });

    it("falls back to the list's flag without an activity", () => {
        const flagged = train({ activity: null, isStale: true });
        expect(trainDisplay(flagged, now).state).toBe("idle");
        const old = train({
            activity: undefined,
            isStale: true,
            lastUpdated: ago(600),
        });
        expect(trainDisplay(old, now).state).toBe("stale");
        expect(trainDisplay(train({ activity: null }), now).state).toBe(
            "running",
        );
    });

    it("agrees for a list feature and the details of the same refresh", () => {
        const shared = { delay: 111, lastUpdated: ago(70) };
        const feature = {
            ...shared,
            vehicleId: "1:1141",
            isStale: true,
            activity: "arrived",
        } as TrainFeatureProperties;
        const details = {
            ...shared,
            vehicleId: "1:1141",
            activity: "arrived",
        } as VehiclePositionWithDelay;
        expect(trainDisplay(details, now)).toEqual(trainDisplay(feature, now));
    });
});

describe("delayLabel", () => {
    it("says on time (no text) up to +5, the minutes after", () => {
        expect(delayLabel(5)).toEqual({
            text: null,
            level: "onTime",
            stale: false,
            minutes: 5,
        });
        expect(delayLabel(-2).text).toBeNull();
        expect(delayLabel(6)).toMatchObject({ text: "+6", level: "slight" });
        expect(delayLabel(74.6)).toMatchObject({
            text: "+75",
            level: "severe",
            minutes: 75,
        });
    });

    it("keeps old data's last number with a '?', greyed and dashed", () => {
        expect(delayLabel(23, true)).toEqual({
            text: "+23?",
            level: "stale",
            stale: true,
            minutes: 23,
        });
        // Never a confident "pontos" on old data
        expect(delayLabel(2, true).text).toBe("+2?");
    });

    it("is a grey dash without a delay", () => {
        expect(delayLabel(null)).toMatchObject({
            text: "–",
            level: "stale",
            minutes: null,
        });
    });
});

describe("delayTile", () => {
    const tile = (delay: number, input: Partial<TrainDisplayInput> = {}) =>
        delayTile(trainDisplay(train({ delay, ...input }), now));

    it("always shows a number, with 'on time' under it up to +5", () => {
        expect(tile(3)).toEqual({
            text: "+3",
            delay: 3,
            level: "onTime",
            stale: false,
            caption: { kind: "on_time" },
        });
        expect(tile(5)).toMatchObject({
            text: "+5",
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
        expect(tile(6)).toMatchObject({
            text: "+6",
            level: "slight",
            caption: null,
        });
        expect(tile(23)).toMatchObject({ text: "+23", level: "moderate" });
        expect(tile(75)).toMatchObject({ text: "+75", level: "severe" });
    });

    it("marks old data's delay with a '?', grey and dashed", () => {
        expect(tile(23, { lastUpdated: ago(600) })).toEqual({
            text: "+23?",
            delay: 23,
            level: "stale",
            stale: true,
            caption: null,
        });
    });

    it("shows no delay for idle trains, but what they are doing", () => {
        expect(tile(109, { activity: null, isStale: true })).toEqual({
            text: "–",
            delay: null,
            level: "stale",
            stale: false,
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

describe("staleNote", () => {
    it("says nothing while the data is fresh", () => {
        expect(staleNote(trainDisplay(train(), now))).toBeNull();
    });

    it("tells the age and the last delay of old data", () => {
        const display = trainDisplay(train({ lastUpdated: ago(6 * 60) }), now);
        expect(staleNote(display)).toEqual({
            minutes: 6,
            delay: "+23",
            onTime: false,
        });
        const onTime = trainDisplay(
            train({ delay: 4, lastUpdated: ago(6 * 60) }),
            now,
        );
        expect(staleNote(onTime)).toMatchObject({ delay: "+4", onTime: true });
    });

    it("tells only the age without a delay", () => {
        const display = trainDisplay(
            train({ activity: "arrived", lastUpdated: ago(9 * 60) }),
            now,
        );
        expect(staleNote(display)).toEqual({
            minutes: 9,
            delay: null,
            onTime: false,
        });
    });
});
