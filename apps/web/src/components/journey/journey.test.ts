import type { Itinerary } from "@megisholavonat/api-client";
import { describe, expect, it } from "vitest";
import { transferGap } from "./journey";

type Leg = Itinerary["legs"][number];

/** A ride from `dep` to `arr` (minutes past 8:00), late by the deltas. */
function ride(dep: number, arr: number, late = { dep: 0, arr: 0 }): Leg {
    const at = (m: number) => 1_793_260_800 + m * 60;
    return {
        type: "transit",
        scheduledDeparture: at(dep),
        expectedDeparture: at(dep + late.dep),
        scheduledArrival: at(arr),
        expectedArrival: at(arr + late.arr),
        realtime: true,
    } as Leg;
}

describe("transferGap", () => {
    it("counts the minutes between the two times shown", () => {
        // 08:02 → 08:15: 13 minutes, as printed
        expect(transferGap(ride(-30, 2), ride(15, 60))).toEqual({
            scheduled: 13,
            expected: 13,
        });
    });

    it("tells the forecast beside them, from the same legs", () => {
        // Arrives 4 late ("pontos" in the chip): 9 minutes left
        expect(
            transferGap(ride(-30, 2, { dep: 0, arr: 4 }), ride(15, 60)),
        ).toEqual({ scheduled: 13, expected: 9 });
        // The next train leaves 3 late too: 12
        expect(
            transferGap(
                ride(-30, 2, { dep: 0, arr: 4 }),
                ride(15, 60, { dep: 3, arr: 3 }),
            ),
        ).toEqual({ scheduled: 13, expected: 12 });
    });

    it("never goes below zero, and needs two rides", () => {
        expect(
            transferGap(ride(-30, 2, { dep: 0, arr: 20 }), ride(15, 60))
                ?.expected,
        ).toBe(0);
        expect(
            transferGap({ type: "walk" } as unknown as Leg, ride(15, 60)),
        ).toBeNull();
        expect(transferGap(undefined, ride(15, 60))).toBeNull();
    });
});
