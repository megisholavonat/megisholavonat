import type { VehiclePositionWithDelay } from "@megisholavonat/api-client";
import { describe, expect, it } from "vitest";
import {
    localActivity,
    sheetInput,
    type TrainDisplayInput,
    trainDisplay,
} from "./trainState";

const now = new Date("2026-08-14T08:00:00Z");
const ago = (s: number) => Math.floor(now.getTime() / 1000) - s;
const H = 3600;

describe("trainDisplay", () => {
    it("shows a running train's live delay", () => {
        expect(
            trainDisplay({ delay: 23.4, lastUpdated: ago(30) }, now),
        ).toEqual({
            state: "running",
            activity: null,
            delay: 23,
            level: "moderate",
            outdated: false,
            minutesSinceUpdate: 0,
        });
    });

    it("keeps an old train's last delay, greyed", () => {
        expect(
            trainDisplay({ delay: 23, lastUpdated: ago(7 * 60) }, now),
        ).toMatchObject({ state: "stale", delay: 23, level: "stale" });
    });

    it("treats the list's flag on fresh data as idle, without a delay", () => {
        // A HÉV waiting at its terminus, updated 36 s ago
        expect(
            trainDisplay(
                { delay: 109, lastUpdated: ago(36), isStale: true },
                now,
            ),
        ).toMatchObject({ state: "idle", delay: null, level: "stale" });
    });

    it("lets an old flagged train be stale, not idle", () => {
        expect(
            trainDisplay(
                { delay: 9, lastUpdated: ago(600), isStale: true },
                now,
            ).state,
        ).toBe("stale");
    });

    it("follows an explicit activity", () => {
        const base = { delay: 9, lastUpdated: ago(30), isStale: true };
        expect(trainDisplay({ ...base, activity: "running" }, now).state).toBe(
            "running",
        );
        expect(
            trainDisplay({ ...base, activity: "arrived" }, now),
        ).toMatchObject({ state: "idle", activity: "arrived" });
        expect(
            trainDisplay({ ...base, activity: "cancelled" }, now).state,
        ).toBe("cancelled");
    });
});

function details(
    last: number | null,
    next: number | null,
    progress: number,
): VehiclePositionWithDelay {
    const stop = (name: string, t: number) => ({
        scheduledArrival: t,
        realtimeArrival: t,
        scheduledDeparture: t,
        realtimeDeparture: t,
        stop: { name, lat: 47, lon: 19 },
    });
    return {
        delay: 12,
        lastUpdated: ago(20),
        vehicleProgress: {
            lastStop: "",
            nextStop: "",
            lastStopIndex: last,
            nextStopIndex: next,
            progress,
        },
        // 08:00 UTC is 10:00 in Budapest
        trip: {
            serviceDate: "2026-08-14",
            stoptimes: [stop("A", 9 * H), stop("B", 11 * H), stop("C", 12 * H)],
        },
    } as unknown as VehiclePositionWithDelay;
}

const display = (input: TrainDisplayInput | null) => {
    if (!input) throw new Error("no input");
    return trainDisplay(input, now);
};

describe("localActivity", () => {
    it("knows a train past its last stop has arrived", () => {
        expect(localActivity(details(2, 2, 1), now)).toBe("arrived");
    });

    it("says nothing for a train under way", () => {
        expect(localActivity(details(0, 1, 0.5), now)).toBeNull();
    });

    it("knows a train before its first departure", () => {
        const early = new Date("2026-08-14T06:30:00Z");
        expect(localActivity(details(0, 0, 0), early)).toBe("beforeDeparture");
    });
});

describe("sheetInput", () => {
    it("uses the details with the list's flag", () => {
        const input = sheetInput(
            details(2, 2, 1),
            { delay: 12, lastUpdated: ago(40), isStale: true },
            now,
        );
        expect(input).toMatchObject({ isStale: true, activity: "arrived" });
        expect(display(input).state).toBe("idle");
    });

    it("ignores the details' guess when the list says the train is active", () => {
        const input = sheetInput(
            details(2, 2, 1),
            { delay: 12, lastUpdated: ago(40), isStale: false },
            now,
        );
        expect(input?.activity).toBeNull();
        expect(display(input).state).toBe("running");
    });

    it("drops the list's flag once the list's own data is old", () => {
        // The flag may only mean "no update"; fresher details win
        const input = sheetInput(
            details(0, 1, 0.5),
            { delay: 12, lastUpdated: ago(900), isStale: true },
            now,
        );
        expect(input?.isStale).toBe(false);
        expect(display(input).state).toBe("running");
    });

    it("falls back to the list feature while details load", () => {
        expect(
            sheetInput(
                undefined,
                { delay: 5, lastUpdated: ago(10), isStale: true },
                now,
            ),
        ).toEqual({ delay: 5, lastUpdated: ago(10), isStale: true });
        expect(sheetInput(undefined, undefined, now)).toBeNull();
    });
});
