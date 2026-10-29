import type { TrainFeatureCollection } from "@megisholavonat/api-client";
import { describe, expect, it } from "vitest";
import { browseTrains, highlight, lateTrains, searchTrains } from "./search";

describe("highlight", () => {
    it("bolds an accent-insensitive match", () => {
        expect(highlight("Budapest-Keleti", "kel")).toEqual([
            { text: "Budapest-", match: false },
            { text: "Kel", match: true },
            { text: "eti", match: false },
        ]);
        expect(highlight("Kőbánya-Kispest", "koba")).toEqual([
            { text: "Kőbá", match: true },
            { text: "nya-Kispest", match: false },
        ]);
    });

    it("returns the text as is without a match", () => {
        expect(highlight("Győr", "pécs")).toEqual([
            { text: "Győr", match: false },
        ]);
    });
});

describe("searchTrains", () => {
    const now = new Date("2026-08-14T08:00:00Z");
    const nowS = now.getTime() / 1000;
    const train = (vehicleId: string, tripShortName: string, ago = 0) => ({
        type: "Feature" as const,
        geometry: { type: "Point", coordinates: [19, 47] },
        properties: {
            type: "train" as const,
            vehicleId,
            lat: 47,
            lon: 19,
            tripShortName,
            routeShortName: "",
            routeTextColor: "",
            delay: 0,
            lastUpdated: nowS - ago,
        },
    });
    const feed = {
        timestamp: now.toISOString(),
        features: [
            train("1:3", "924 InterCity"),
            train("1:1", "92 InterCity"),
            train("1:2", "9240 személyvonat", 3600),
        ],
    } as TrainFeatureCollection;

    it("finds live trains by number, in number order", () => {
        expect(searchTrains(feed, "92", now).map((t) => t.vehicleId)).toEqual([
            "1:1",
            "1:3",
        ]);
    });

    it("needs a query", () => {
        expect(searchTrains(feed, " ", now)).toEqual([]);
    });
});

describe("browseTrains and lateTrains", () => {
    const now = new Date("2026-08-14T08:00:00Z");
    const nowS = now.getTime() / 1000;
    const train = (
        vehicleId: string,
        delay: number,
        extra: { ago?: number; isStale?: boolean } = {},
    ) => ({
        type: "Feature" as const,
        geometry: { type: "Point", coordinates: [19, 47] },
        properties: {
            type: "train" as const,
            vehicleId,
            lat: 47,
            lon: 19,
            tripShortName: vehicleId,
            routeShortName: "",
            routeTextColor: "",
            delay,
            lastUpdated: nowS - (extra.ago ?? 0),
            isStale: extra.isStale,
        },
    });
    const feed = {
        timestamp: now.toISOString(),
        features: [
            train("10", 3),
            train("20", 45),
            train("30", 109, { isStale: true }),
            train("40", 12),
            train("50", 80, { ago: 600 }),
            train("60", 9, { ago: 3600 }),
        ],
    } as TrainFeatureCollection;
    const ids = (list: { vehicleId: string }[]) => list.map((t) => t.vehicleId);

    it("sorts live trains by delay, idle and old ones last", () => {
        expect(ids(browseTrains(feed, "delay", now))).toEqual([
            "20",
            "40",
            "10",
            "30",
            "50",
        ]);
    });

    it("sorts by number", () => {
        expect(ids(browseTrains(feed, "number", now))).toEqual([
            "10",
            "20",
            "30",
            "40",
            "50",
        ]);
    });

    it("lists only trains running late", () => {
        expect(ids(lateTrains(feed, now))).toEqual(["20", "40"]);
        expect(ids(lateTrains(feed, now, 1))).toEqual(["20"]);
    });
});
