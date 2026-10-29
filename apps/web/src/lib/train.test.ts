import type { VehiclePositionWithDelay } from "@megisholavonat/api-client";
import { describe, expect, it } from "vitest";
import { runStops } from "./train";

const stop = (id: string, at: number) => ({
    stop: { gtfsId: `1:${id}`, name: id, lat: 0, lon: 0 },
    scheduledArrival: at,
    scheduledDeparture: at,
});

const vehicle = (serviceDate: string, stops: [string, number][]) =>
    ({
        trip: {
            serviceDate,
            stoptimes: stops.map(([id, at]) => stop(id, at)),
        },
    }) as unknown as VehiclePositionWithDelay;

describe("runStops", () => {
    it("dates a HÉV after midnight on the day it runs", () => {
        // OTP dates Thursday's 00:20 HÉV as Wednesday, stoptimes from 00:10
        const hev = vehicle("2026-10-28", [
            ["005510009", 600],
            ["005517228", 1200],
        ]);
        const now = new Date("2026-10-28T23:05:00Z"); // Thu 00:05
        expect(runStops(hev, now).map((s) => s.date)).toEqual([
            "2026-10-29",
            "2026-10-29",
        ]);
    });

    it("dates train 10 on the evening it leaves", () => {
        const ten = vehicle("2026-10-30", [
            ["005510009", 23 * 3600],
            ["005517228", 25 * 3600],
        ]);
        const now = new Date("2026-10-29T21:30:00Z"); // Thu 22:30
        expect(runStops(ten, now).map((s) => s.date)).toEqual([
            "2026-10-29",
            "2026-10-30",
        ]);
    });
});
