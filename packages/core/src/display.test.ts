import type {
    TrainFeatureProperties,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";
import { describe, expect, it } from "vitest";
import { type TrainDisplayInput, trainDisplay } from "./display";

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

    it("labels nothing for an on-time running train", () => {
        const display = trainDisplay(train({ delay: 4 }), now);
        expect(display).toMatchObject({ level: "onTime", delay: 4, label: "" });
    });

    it("keeps a stale train's last delay, greyed, with the data's age", () => {
        expect(trainDisplay(train({ lastUpdated: ago(7 * 60) }), now)).toEqual({
            state: "stale",
            activity: "running",
            delay: 23,
            level: "stale",
            outdated: true,
            minutesSinceUpdate: 7,
            label: "7′",
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

    it("labels an idle train's age once its data is old", () => {
        const display = trainDisplay(
            train({ activity: "arrived", lastUpdated: ago(9 * 60) }),
            now,
        );
        expect(display).toMatchObject({
            state: "idle",
            delay: null,
            label: "9′",
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
