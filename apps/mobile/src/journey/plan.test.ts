import type {
    Itinerary,
    Station,
    Transfer,
    TransitLeg,
} from "@megisholavonat/api-client";
import { afterEach, describe, expect, it } from "vitest";
import {
    durationParts,
    itineraryKey,
    type Ride,
    rideDelay,
    riskColorLevel,
    steps,
    timeParam,
    transferRisk,
    type Walk,
    worstRisk,
} from "./plan";
import { planner } from "./store";

const stop = (name: string) => ({ id: name, name, lat: 47, lon: 19 });

const ride = (extra: Partial<TransitLeg> = {}): Ride => ({
    mode: "RAIL",
    tripId: "1:1",
    tripShortName: "79 MUNTENIA InterCity",
    trainNumber: "79",
    routeShortName: "",
    serviceDate: "2026-10-29",
    fromStop: stop("Budapest-Keleti"),
    toStop: stop("Szolnok"),
    scheduledDeparture: 1000,
    expectedDeparture: 1000,
    scheduledArrival: 5000,
    expectedArrival: 5000,
    delayMinutes: 0,
    delaySource: "otp",
    realtime: true,
    intermediateStops: 2,
    ...extra,
    type: "transit",
});

const walk: Walk = {
    type: "walk",
    fromStop: stop("Szolnok"),
    toStop: stop("Szolnok"),
    departureTime: 5000,
    arrivalTime: 5120,
    distanceMeters: 100,
};

const transfer = (extra: Partial<Transfer> = {}): Transfer => ({
    fromLeg: 0,
    toLeg: 2,
    station: "Szolnok",
    transferMinutes: 9,
    expectedTransferMinutes: 9,
    ...extra,
});

const itinerary = (legs: Itinerary["legs"], transfers: Transfer[]) =>
    ({
        scheduledDeparture: 1000,
        expectedDeparture: 1000,
        scheduledArrival: 9000,
        expectedArrival: 9000,
        durationMinutes: 133,
        transferCount: transfers.length,
        legs,
        transfers,
        ticketUrl: "https://jegy.mav.hu/",
    }) satisfies Itinerary;

describe("transfer risk", () => {
    it("uses the level, and cancellations above all", () => {
        expect(transferRisk(transfer())).toBeNull();
        expect(transferRisk(transfer({ risk: "tight" }))).toBe("tight");
        expect(
            transferRisk(
                transfer({ risk: "likely_missed", riskSource: "canceled" }),
            ),
        ).toBe("canceled");
    });

    it("colours safe like on time and misses true red", () => {
        expect(riskColorLevel("safe")).toBe("onTime");
        expect(riskColorLevel("tight")).toBe("moderate");
        expect(riskColorLevel("likely_missed")).toBe("severe");
        expect(riskColorLevel("canceled")).toBe("severe");
    });

    it("summarises a journey by its riskiest transfer", () => {
        expect(worstRisk([])).toBeNull();
        expect(
            worstRisk([
                transfer({ risk: "safe" }),
                transfer({ risk: "tight" }),
                transfer(),
            ]),
        ).toBe("tight");
    });
});

describe("legs", () => {
    it("shows live delays only, never negative", () => {
        expect(rideDelay(ride({ delayMinutes: 7 }))).toBe(7);
        expect(rideDelay(ride({ delayMinutes: -2 }))).toBe(0);
        expect(rideDelay(ride({ realtime: false }))).toBeNull();
        expect(rideDelay(ride({ canceled: true }))).toBeNull();
    });

    it("puts each transfer after the train it leaves", () => {
        const second = ride({ tripId: "1:2", scheduledDeparture: 5400 });
        const it = itinerary([ride(), walk, second], [transfer()]);
        expect(steps(it).map((s) => s.kind)).toEqual([
            "ride",
            "transfer",
            "walk",
            "ride",
        ]);
        expect(itineraryKey(it)).toBe("1:1@1000|1:2@5400");
    });

    it("splits durations", () => {
        expect(durationParts(133)).toEqual({ hours: 2, minutes: 13 });
        expect(durationParts(45)).toEqual({ hours: 0, minutes: 45 });
    });

    it("sends no time for now", () => {
        expect(timeParam(null)).toBeUndefined();
        expect(timeParam(Date.UTC(2026, 9, 29, 14, 5))).toBe(
            "2026-10-29T14:05:00.000Z",
        );
    });
});

describe("planner store", () => {
    const keleti: Station = { id: "1", name: "Keleti", lat: 0, lon: 0 };
    const szolnok: Station = { id: "2", name: "Szolnok", lat: 0, lon: 0 };
    afterEach(() => planner.reset());

    it("swaps the ends", () => {
        planner.pick("from", keleti);
        planner.pick("to", szolnok);
        planner.swap();
        expect(planner.get()).toMatchObject({ from: szolnok, to: keleti });
    });

    it("swaps when a station is picked for the other end", () => {
        planner.pick("from", keleti);
        planner.pick("to", szolnok);
        planner.pick("to", keleti);
        expect(planner.get()).toMatchObject({ from: szolnok, to: keleti });
    });
});
