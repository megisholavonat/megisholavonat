import type { VehiclePositionWithDelay } from "@megisholavonat/api-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STALE_GREY_AFTER_S, STALE_HIDE_AFTER_S } from "./constants";
import { dataAppearsFalsified, isActive, isStale } from "./vehicle";

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

// Mirrors apps/api/tests/test_staleness.py
describe("isActive", () => {
    const ORIGIN = { name: "x", lat: 47.0, lon: 19.0 };
    const DESTINATION = { name: "y", lat: 47.0, lon: 19.5 };

    function atOrigin(serviceDate: string, departs: number, duration = 3600) {
        const at = (time: number) => ({
            scheduledArrival: time,
            realtimeArrival: time,
            scheduledDeparture: time,
            realtimeDeparture: time,
        });
        return {
            vehicleId: "v",
            lat: 47.0,
            lon: 19.005,
            delay: 0,
            lastUpdated: 0,
            trip: {
                serviceDate,
                tripGeometry: { points: "" },
                stoptimes: [
                    { ...at(departs), stop: ORIGIN },
                    { ...at(departs + duration), stop: DESTINATION },
                ],
            },
        } as unknown as VehiclePositionWithDelay;
    }

    // Budapest wall-clock time to a Date (CEST in August)
    const cest = (iso: string) => new Date(`${iso}+02:00`);

    it("judges a daytime train against its own service date", () => {
        const train = atOrigin("2026-08-14", 8 * 3600 + 300);
        expect(isActive(train, cest("2026-08-14T08:00:00"))).toBe(false);
        expect(isActive(train, cest("2026-08-14T08:10:00"))).toBe(true);
        // Still attached in the evening: the service date is kept
        expect(isActive(train, cest("2026-08-14T20:43:00"))).toBe(true);
    });

    it.each([
        // Waiting for its 00:18 departure; read naively it was 24h past it
        ["2026-08-15T00:10:00", false],
        ["2026-08-15T00:20:00", true],
        // Before midnight; read naively it was 23h past its departure
        ["2026-08-14T23:50:00", false],
    ])("after-midnight HÉV with the previous day's date at %s", (now, active) => {
        const hev = atOrigin("2026-08-14", 18 * 60);
        expect(isActive(hev, cest(now))).toBe(active);
    });

    it.each([
        ["2026-08-14T22:30:00", false],
        // Departed but still near the origin; read naively it was 24h early
        ["2026-08-14T22:45:00", true],
    ])("overnight train with the next day's date at %s", (now, active) => {
        const train = atOrigin("2026-08-15", 22 * 3600 + 40 * 60, 8 * 3600);
        expect(isActive(train, cest(now))).toBe(active);
    });

    it.each([
        // 27:00 on the service clock is 03:00 CET, i.e. 04:00 CEST: the day
        // starts at local noon minus 12h, not by wall-clock hours
        ["2026-03-29T03:30:00", false],
        ["2026-03-29T04:05:00", true],
    ])("across the spring DST change at %s", (now, active) => {
        const train = atOrigin("2026-03-28", 27 * 3600);
        expect(isActive(train, cest(now))).toBe(active);
    });
});

describe("isStale", () => {
    const now = new Date("2026-08-14T08:00:00Z");
    const updatedAgo = (seconds: number) =>
        ({
            lastUpdated: now.getTime() / 1000 - seconds,
        }) as unknown as VehiclePositionWithDelay;

    it("greys after 5 minutes and the API hides after 30", () => {
        expect(STALE_GREY_AFTER_S).toBe(300);
        expect(STALE_HIDE_AFTER_S).toBe(1800);
    });

    it("is stale only after STALE_GREY_AFTER_S without an update", () => {
        expect(isStale(updatedAgo(60), now)).toBe(false);
        expect(isStale(updatedAgo(STALE_GREY_AFTER_S), now)).toBe(false);
        expect(isStale(updatedAgo(STALE_GREY_AFTER_S + 1), now)).toBe(true);
    });
});
