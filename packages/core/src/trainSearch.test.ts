import type { TrainFeatureProperties } from "@megisholavonat/api-client";
import { describe, expect, it } from "vitest";
import { compareTrains, matchesTrainQuery } from "./trainSearch";

function train(
    overrides: Partial<TrainFeatureProperties>,
): TrainFeatureProperties {
    return {
        type: "train",
        vehicleId: "1:915504800123",
        lat: 47.5,
        lon: 19.04,
        tripShortName: "1234",
        routeShortName: "",
        routeTextColor: "FFFFFF",
        delay: 0,
        ...overrides,
    };
}

describe("matchesTrainQuery", () => {
    it("matches everything for a blank query", () => {
        expect(matchesTrainQuery(train({}), "")).toBe(true);
        expect(matchesTrainQuery(train({}), "   ")).toBe(true);
    });

    it("matches the trip name ignoring case and diacritics", () => {
        const t = train({ tripShortName: "Győr IC 921" });
        expect(matchesTrainQuery(t, "gyor")).toBe(true);
        expect(matchesTrainQuery(t, "  IC 92 ")).toBe(true);
        expect(matchesTrainQuery(t, "sopron")).toBe(false);
    });

    it("matches the route name and MÁV route icons", () => {
        expect(
            matchesTrainQuery(train({ routeShortName: "Tópart" }), "topart"),
        ).toBe(true);
        expect(
            matchesTrainQuery(train({ routeShortName: "&#335;" }), "S 10"),
        ).toBe(true);
    });

    it("matches the vehicle id without its prefix, ignoring spaces and dashes", () => {
        const t = train({ vehicleId: "1:915504800123" });
        expect(matchesTrainQuery(t, "0480 012-3")).toBe(true);
        // The first two characters ("1:") are dropped before matching
        expect(matchesTrainQuery(t, "1:9155")).toBe(false);
    });
});

describe("compareTrains", () => {
    const a = train({ tripShortName: "9", delay: 10, speed: 20 });
    const b = train({ tripShortName: "10", delay: 3, speed: null });
    const c = train({ tripShortName: "100", delay: 30, speed: 5 });

    const names = (list: TrainFeatureProperties[]) =>
        list.map((t) => t.tripShortName);

    it("sorts by trip number numerically", () => {
        expect(names([c, b, a].sort(compareTrains("number", "asc")))).toEqual([
            "9",
            "10",
            "100",
        ]);
        expect(names([a, b, c].sort(compareTrains("number", "desc")))).toEqual([
            "100",
            "10",
            "9",
        ]);
    });

    it("sorts by delay", () => {
        expect(names([a, b, c].sort(compareTrains("delay", "asc")))).toEqual([
            "10",
            "9",
            "100",
        ]);
        expect(names([a, b, c].sort(compareTrains("delay", "desc")))).toEqual([
            "100",
            "9",
            "10",
        ]);
    });

    it("sorts by speed, treating a missing speed as 0", () => {
        expect(names([a, b, c].sort(compareTrains("speed", "asc")))).toEqual([
            "10",
            "100",
            "9",
        ]);
    });
});
