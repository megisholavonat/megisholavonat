import type { TrainFeatureCollection } from "@megisholavonat/api-client";
import { describe, expect, it } from "vitest";
import { highlight, searchTrains } from "./search";

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
