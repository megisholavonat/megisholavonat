import type { VehiclePositionWithDelay } from "@megisholavonat/api-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataAppearsFalsified } from "./vehicle";

function stoptime(scheduled: number, realtime: number) {
    return {
        scheduledArrival: scheduled,
        realtimeArrival: realtime,
        scheduledDeparture: scheduled,
        realtimeDeparture: realtime,
        stop: { name: "x", lat: 47, lon: 19 },
    };
}

describe("dataAppearsFalsified", () => {
    // Stop A: due 06:30, expected 07:00 (30 min late), already passed.
    // Stop B: due 08:50, expected 09:00 (10 min late), the next stop.
    const vehicle = {
        delay: 12,
        lastUpdated: 0,
        trip: {
            serviceDate: "2026-08-14",
            stoptimes: [
                stoptime(6.5 * 3600, 7 * 3600),
                stoptime((8 * 60 + 50) * 60, 9 * 3600),
            ],
        },
    } as unknown as VehiclePositionWithDelay;

    beforeEach(() => {
        // 08:00 in Budapest (CEST); tests run with TZ=UTC
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-08-14T06:00:00Z"));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("compares against the next stop in Budapest time, not device time", () => {
        // 08:00 in Budapest (CEST) is 06:00 UTC, the device's zone under test.
        // With device-local midnight, stop A would look upcoming and its
        // 30 min delay would disagree with ours (12 min).
        expect(dataAppearsFalsified(vehicle, false)).toBe(false);
    });

    it("flags a delay that disagrees with the next stop", () => {
        const late = { ...vehicle, delay: 25 };
        expect(dataAppearsFalsified(late, false)).toBe(true);
    });

    it("never flags stale data", () => {
        expect(dataAppearsFalsified({ ...vehicle, delay: 25 }, true)).toBe(
            false,
        );
    });
});
