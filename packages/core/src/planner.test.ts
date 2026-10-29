import type { CityLeg, Itinerary } from "@megisholavonat/api-client";
import { describe, expect, it } from "vitest";
import {
    alightingElsewhere,
    boardingElsewhere,
    cityLineColors,
    cityMode,
    collapseTwinStations,
    legChain,
    matchesBudapest,
} from "./planner";

const stop = (id: string | null, name: string) => ({
    id,
    name,
    lat: 0,
    lon: 0,
});

const city = (over: Partial<CityLeg> = {}): CityLeg & { type: "city" } => ({
    type: "city",
    mode: "BUS",
    line: "8E",
    routeColor: "009EE3",
    routeTextColor: "FFFFFF",
    fromStop: stop(null, "Budapest, Keleti pályaudvar M"),
    toStop: stop(null, "Budapest, Zugló vasútállomás"),
    scheduledDeparture: 0,
    expectedDeparture: 0,
    scheduledArrival: 300,
    expectedArrival: 300,
    realtime: false,
    intermediateStops: 0,
    ...over,
});

const train = (
    from: [string, string],
    to: [string, string],
    number = "712",
) => ({
    type: "transit" as const,
    mode: "RAIL",
    tripId: `1:${number}`,
    tripShortName: number,
    trainNumber: number,
    routeShortName: "",
    serviceDate: "2026-10-30",
    fromStop: stop(...from),
    toStop: stop(...to),
    scheduledDeparture: 600,
    expectedDeparture: 600,
    scheduledArrival: 9000,
    expectedArrival: 9000,
    delayMinutes: 0,
    delaySource: "otp" as const,
    realtime: false,
    intermediateStops: 3,
});

const itinerary = (legs: Itinerary["legs"]): Itinerary => ({
    scheduledDeparture: 0,
    expectedDeparture: 0,
    scheduledArrival: 9000,
    expectedArrival: 9000,
    durationMinutes: 150,
    transferCount: 0,
    legs,
    transfers: [],
    ticketUrl: "",
});

const ZUGLO: [string, string] = ["005510090", "Zugló"];
const KELETI: [string, string] = ["005510017", "Budapest-Keleti"];
const SZEGED: [string, string] = ["005517228", "Szeged"];

describe("matchesBudapest", () => {
    it.each([
        "bu",
        "Budap",
        "budapest",
        "BUDAPEST ",
        "bp",
        "Bp.",
    ])("matches %j", (q) => expect(matchesBudapest(q)).toBe(true));
    it.each([
        "b",
        "budafok",
        "keleti",
        "pest",
        "budapest keleti",
        "",
    ])("does not match %j", (q) => expect(matchesBudapest(q)).toBe(false));
});

describe("collapseTwinStations", () => {
    const szeged = {
        id: "005517228",
        name: "Szeged",
        lat: 46.239722,
        lon: 20.143056,
    };
    const tramTrain = {
        id: "005500700",
        name: "Szeged vasútállomás",
        lat: 46.239789,
        lon: 20.142561,
    };
    const rokus = {
        id: "005500712",
        name: "Szeged, Rókus vasútállomás",
        lat: 46.266107,
        lon: 20.125686,
    };

    it("drops the tram-train stop in front of the station", () => {
        expect(collapseTwinStations([szeged, tramTrain, rokus])).toEqual([
            szeged,
            rokus,
        ]);
    });

    it("keeps it without its twin, or when far away", () => {
        expect(collapseTwinStations([tramTrain])).toEqual([tramTrain]);
        const far = { ...szeged, lat: 46.3 };
        expect(collapseTwinStations([far, tramTrain])).toEqual([
            far,
            tramTrain,
        ]);
    });
});

describe("boarding and alighting elsewhere", () => {
    const viaZuglo = itinerary([city(), train(ZUGLO, SZEGED)]);
    const direct = itinerary([train(KELETI, SZEGED)]);

    it("names the station when the train leaves from another one", () => {
        expect(boardingElsewhere(viaZuglo, KELETI[0])).toBe("Zugló");
        expect(boardingElsewhere(direct, KELETI[0])).toBeNull();
    });

    it("always names it from any Budapest station", () => {
        expect(boardingElsewhere(direct, "budapest")).toBe("Budapest-Keleti");
        expect(alightingElsewhere(direct, "budapest")).toBe("Szeged");
        expect(alightingElsewhere(direct, SZEGED[0])).toBeNull();
    });

    it("chains trains and city rides without walks", () => {
        const walk = {
            type: "walk" as const,
            fromStop: stop(null, "a"),
            toStop: stop(null, "b"),
            departureTime: 0,
            arrivalTime: 60,
            distanceMeters: 80,
        };
        const legs = legChain(
            itinerary([walk, city(), walk, train(ZUGLO, SZEGED)]),
        );
        expect(legs.map((leg) => leg.type)).toEqual(["city", "transit"]);
    });
});

describe("city lines", () => {
    it("uses the feed's colours", () => {
        expect(cityLineColors(city())).toEqual({
            background: "#009EE3",
            text: "#FFFFFF",
        });
    });

    it("picks a readable text colour when the feed has none", () => {
        expect(
            cityLineColors(
                city({ routeColor: "FFD800", routeTextColor: null }),
            ),
        ).toEqual({ background: "#FFD800", text: "#000000" });
        expect(
            cityLineColors(city({ routeColor: "005CA5", routeTextColor: "" })),
        ).toEqual({ background: "#005CA5", text: "#FFFFFF" });
    });

    it("has no colours without a valid one", () => {
        expect(cityLineColors(city({ routeColor: null }))).toBeNull();
        expect(cityLineColors(city({ routeColor: "blue" }))).toBeNull();
    });

    it("tells the modes apart", () => {
        expect(cityMode({ mode: "SUBWAY" })).toBe("metro");
        expect(cityMode({ mode: "TRAM" })).toBe("tram");
        expect(cityMode({ mode: "TROLLEYBUS" })).toBe("trolleybus");
        expect(cityMode({ mode: "SUBURBAN_RAILWAY" })).toBe("rail");
        expect(cityMode({ mode: "BUS" })).toBe("bus");
    });
});
