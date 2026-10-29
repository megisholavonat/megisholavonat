import type { TrainFeatureProperties } from "@megisholavonat/api-client";
import { describe, expect, it } from "vitest";
import {
    browseTrains,
    compareTrains,
    lateTrains,
    liveSpeedKmh,
    matchesTrainQuery,
} from "./trainSearch";

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
        lastUpdated: 0,
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

describe("browseTrains", () => {
    const now = new Date(1_000_000 * 1000);
    const fresh = now.getTime() / 1000 - 30;
    const live = { lastUpdated: fresh, activity: "running" as const };
    const trains = [
        train({
            vehicleId: "a",
            tripShortName: "20",
            delay: 3,
            speed: 30,
            ...live,
        }),
        train({
            vehicleId: "b",
            tripShortName: "3",
            delay: 45,
            speed: 10,
            ...live,
        }),
        train({
            vehicleId: "c",
            tripShortName: "100",
            delay: 90,
            speed: 0,
            lastUpdated: fresh,
            activity: "beforeDeparture",
        }),
        // Old data: grey, no live delay or speed
        train({
            vehicleId: "d",
            tripShortName: "7",
            delay: 12,
            speed: 25,
            ...live,
            lastUpdated: fresh - 600,
        }),
        // Hidden
        train({
            vehicleId: "e",
            tripShortName: "8",
            ...live,
            lastUpdated: fresh - 3600,
        }),
    ];
    const ids = (list: TrainFeatureProperties[]) =>
        list.map((t) => t.vehicleId);

    it("sorts by the shown delay, trains without one last", () => {
        expect(ids(browseTrains(trains, "delay", "desc", now))).toEqual([
            "b",
            "a",
            "d",
            "c",
        ]);
        expect(ids(browseTrains(trains, "delay", "asc", now))).toEqual([
            "a",
            "b",
            "d",
            "c",
        ]);
    });

    it("sorts by number and by live speed", () => {
        expect(ids(browseTrains(trains, "number", "asc", now))).toEqual([
            "b",
            "d",
            "a",
            "c",
        ]);
        expect(ids(browseTrains(trains, "speed", "desc", now))).toEqual([
            "a",
            "b",
            "d",
            "c",
        ]);
    });

    it("lists the late trains, latest first", () => {
        expect(ids(lateTrains(trains, 5, now))).toEqual(["b"]);
    });

    it("gives a running train's speed in km/h", () => {
        expect(liveSpeedKmh(trains[0], now)).toBe(108);
        expect(liveSpeedKmh(trains[3], now)).toBeNull();
    });
});
