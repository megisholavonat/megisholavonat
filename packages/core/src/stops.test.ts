import type { VehiclePositionWithDelay } from "@megisholavonat/api-client";
import { describe, expect, it } from "vitest";
import {
    arrivalIsEstimate,
    beforeDeparture,
    isEstimate,
    predictedDelays,
    stationIdOf,
    stopTiming,
} from "./stops";

const H = 3600;
const M = 60;

/** A stop at 17:00 waiting `dwell` seconds, with realtime times. */
function st(
    realtimeArrival = 17 * H,
    realtimeDeparture = 17 * H + 2 * M,
    dwell = 2 * M,
) {
    return {
        scheduledArrival: 17 * H,
        scheduledDeparture: 17 * H + dwell,
        realtimeArrival,
        realtimeDeparture,
    };
}

describe("stationIdOf", () => {
    it("prefers the UIC code and falls back to the gtfsId", () => {
        expect(stationIdOf({ stationUicPricingCode: "005510017" })).toBe(
            "005510017",
        );
        expect(stationIdOf({ gtfsId: "1:005501024_14" })).toBe("005501024");
        expect(stationIdOf({ gtfsId: "1:005505876_5b" })).toBe("005505876");
        expect(stationIdOf({})).toBeNull();
    });

    it("splits the feed prefix like the API's util/stop.py", () => {
        // Only the first colon: "1:a:b_2" -> "a:b"
        expect(stationIdOf({ gtfsId: "1:a:b_2" })).toBe("a:b");
        // No feed prefix: the id itself (mobile used to give null)
        expect(stationIdOf({ gtfsId: "005501024_14" })).toBe("005501024");
    });
});

describe("stopTiming", () => {
    it("uses the actual times of a passed stop", () => {
        const t = stopTiming(st(17 * H + 4 * M, 17 * H + 7 * M), 2, true, 9);
        expect(t).toMatchObject({
            scheduled: 17 * H,
            expected: 17 * H + 4 * M,
            delay: 4,
            estimated: false,
            departure: { scheduled: 17 * H + 2 * M, expected: 17 * H + 7 * M },
        });
    });

    it("uses a published realtime time for a stop ahead", () => {
        // MÁV's own time wins over the GPS delay carried forward
        const t = stopTiming(st(17 * H + 8 * M, 17 * H + 10 * M), 2, false, 3);
        expect(t).toMatchObject({
            expected: 17 * H + 8 * M,
            delay: 8,
            estimated: false,
        });
    });

    it("carries the current delay forward without a realtime time", () => {
        const t = stopTiming(st(17 * H, 17 * H + 2 * M), 2, false, 5);
        expect(t).toMatchObject({
            expected: 17 * H + 5 * M,
            delay: 5,
            estimated: true,
            departure: { expected: 17 * H + 7 * M },
        });
    });

    it("never carries an early train's delay forward", () => {
        const t = stopTiming(st(), 2, false, -3);
        expect(t).toMatchObject({ expected: 17 * H, estimated: false });
    });

    it("prefers the per-stop forecast, early ones too", () => {
        expect(stopTiming(st(), 2, false, 10, 4)).toMatchObject({
            delay: 4,
            estimated: true,
        });
        // Not clamped at zero (mobile used to show the timetable's time)
        expect(stopTiming(st(), 2, false, 0, -2).delay).toBe(-2);
        // A forecast of zero is still ours
        expect(stopTiming(st(), 2, false, 0, 0).estimated).toBe(true);
    });

    it("times the first stop by its departure", () => {
        const t = stopTiming(st(), 0, false, 0);
        expect(t).toMatchObject({
            scheduled: 17 * H + 2 * M,
            departure: null,
            leaves: { scheduled: 17 * H + 2 * M, expected: 17 * H + 2 * M },
        });
    });

    it("has no departure at the last stop", () => {
        const t = stopTiming(st(), 4, false, 0, null, true);
        expect(t.departure).toBeNull();
        expect(t.leaves).toBeNull();
    });

    it("shows a departure for a scheduled wait of a minute or more", () => {
        expect(stopTiming(st(), 2, false, 0).departure).not.toBeNull();
        const short = stopTiming(st(17 * H, 17 * H + 30, 30), 2, false, 0);
        expect(short.departure).toBeNull();
        // Still tells when the train leaves
        expect(short.leaves).toMatchObject({ expected: 17 * H + 30 });
    });

    it("shows a departure for an expected wait of a minute or more", () => {
        // Scheduled through without a wait, but held for 3 minutes
        const t = stopTiming(st(17 * H + M, 17 * H + 4 * M, 0), 2, true, 0);
        expect(t.departure).toEqual({
            scheduled: 17 * H,
            expected: 17 * H + 4 * M,
        });
    });

    it("never leaves before it arrives", () => {
        // Realtime departure published before the realtime arrival
        const t = stopTiming(st(17 * H + 9 * M, 17 * H + 5 * M), 2, true, 0);
        expect(t.expected).toBe(17 * H + 9 * M);
        expect(t.departure?.expected).toBe(17 * H + 9 * M);
        expect(t.leaves?.expected).toBe(17 * H + 9 * M);
    });
});

describe("predictedDelays", () => {
    it("keys the forecasts by stop index", () => {
        const vehicle = {
            processedStops: [
                { index: 3, predictedDelay: 4 },
                { predictedDelay: 2 },
            ],
        } as unknown as VehiclePositionWithDelay;
        const map = predictedDelays(vehicle);
        expect(map.get(3)).toBe(4);
        expect(map.get(1)).toBe(2);
        expect(predictedDelays({ processedStops: [] }).size).toBe(0);
    });
});

describe("beforeDeparture", () => {
    const vehicle = {
        trip: {
            serviceDate: "2026-08-14",
            stoptimes: [
                {
                    scheduledDeparture: 16 * H,
                    realtimeDeparture: 16 * H + 2 * M,
                },
            ],
        },
    } as unknown as VehiclePositionWithDelay;

    it("waits until the realtime departure", () => {
        // 16:01 in Budapest (CEST, UTC+2)
        expect(beforeDeparture(vehicle, new Date("2026-08-14T14:01:00Z"))).toBe(
            true,
        );
        expect(beforeDeparture(vehicle, new Date("2026-08-14T14:03:00Z"))).toBe(
            false,
        );
    });
});

describe("isEstimate", () => {
    const ahead = { index: 3, passed: false, timing: { estimated: true } };

    it("is an estimate ahead of the train", () => {
        expect(isEstimate(ahead, false)).toBe(true);
        expect(arrivalIsEstimate(ahead, false, false)).toBe(true);
    });

    it("marks every stop ahead of a train without live data", () => {
        const plain = { ...ahead, timing: { estimated: false } };
        expect(isEstimate(plain, false)).toBe(false);
        expect(isEstimate(plain, true)).toBe(true);
        // But not the first stop's departure, the timetable's time
        expect(isEstimate({ ...plain, index: 0 }, true)).toBe(false);
    });

    it("is actual once the train stands at the stop", () => {
        // 36614 at Hajdúdorog: "Itt áll", its 12:05 arrival has happened
        expect(arrivalIsEstimate(ahead, false, true)).toBe(false);
        expect(arrivalIsEstimate(ahead, true, true)).toBe(false);
    });

    it("is never an estimate at a passed stop", () => {
        expect(arrivalIsEstimate({ ...ahead, passed: true }, true, false)).toBe(
            false,
        );
    });
});
