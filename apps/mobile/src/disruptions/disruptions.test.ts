import type { Disruption } from "@megisholavonat/api-client";
import { describe, expect, it } from "vitest";
import type { LocalFollow } from "../follow/model";
import { fullTexts, interestsOf } from "./disruptions";

const follow = {
    tripShortName: "36810 személyvonat",
    stops: [
        { stopId: null, stationId: "005515875", name: "Mándok", time: 0 },
        { stopId: null, stationId: "005514175", name: "Záhony", time: 600 },
    ],
    from: 0,
    to: 1,
} as LocalFollow;

const base = {
    start: 0,
    end: 3 * 86_400,
    description:
        "Mándok és Tornyospálca között pótlóbusz közlekedik:\n\nMegállói: \nMándok",
    details: ["", "Második szöveg"],
} as unknown as Disruption;

describe("interestsOf", () => {
    it("takes the train number and both ends of the ride", () => {
        expect(interestsOf([follow])).toEqual([
            { trainNumber: "36810", stationIds: ["005515875", "005514175"] },
        ]);
    });
});

describe("fullTexts", () => {
    it("squeezes blank lines and drops empty texts", () => {
        expect(fullTexts(base)).toEqual([
            "Mándok és Tornyospálca között pótlóbusz közlekedik:\nMegállói:\nMándok",
            "Második szöveg",
        ]);
    });
});
