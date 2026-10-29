import { afterEach, describe, expect, it, vi } from "vitest";
import {
    ApiUnavailableError,
    directorySegments,
    fetchTrainPage,
    isTrainNumber,
    lookupStation,
} from "./data";

const KELETI = { id: "005510017", name: "Budapest-Keleti", lat: 47.5, lon: 19 };
const BUK_HU = { id: "004305231", name: "Bük", lat: 47.38, lon: 16.75 };
const BUK_PL = { id: "005102723", name: "Buk", lat: 52.34, lon: 16.52 };
const SEARCH: Record<string, unknown[]> = {
    "budapest keleti": [
        KELETI,
        { id: "1", name: "Budapest-Keleti pu. (alsó)", lat: 0, lon: 0 },
    ],
    buk: [BUK_HU, BUK_PL, { id: "2", name: "Bukovec", lat: 0, lon: 0 }],
};
const BOARDS: Record<string, unknown> = {
    [KELETI.id]: { station: KELETI, entries: [] },
    [BUK_PL.id]: { station: BUK_PL, entries: [] },
};

/** The API by path; a function answers with its own status */
function api(routes: (url: URL) => [number, unknown]) {
    vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string) => {
            const [status, body] = routes(new URL(input));
            return new Response(JSON.stringify(body), { status });
        }),
    );
}

function stationsApi() {
    api((url) => {
        if (url.pathname === "/v1/stations") {
            return [200, SEARCH[url.searchParams.get("q") ?? ""] ?? []];
        }
        const board = url.pathname.match(/^\/v1\/stations\/(\d+)\/departures/);
        if (board) {
            const found = BOARDS[board[1]];
            return found ? [200, found] : [404, { detail: "Not Found" }];
        }
        return [404, {}];
    });
}

afterEach(() => vi.unstubAllGlobals());

describe("lookupStation", () => {
    it("finds a station by its slug", async () => {
        stationsApi();
        await expect(lookupStation("budapest-keleti")).resolves.toEqual({
            kind: "found",
            station: KELETI,
            segment: "budapest-keleti",
        });
    });

    it("redirects other spellings and bare ids to the slug", async () => {
        stationsApi();
        await expect(lookupStation("Budapest-Keleti")).resolves.toEqual({
            kind: "redirect",
            segment: "budapest-keleti",
        });
        await expect(lookupStation("005510017")).resolves.toEqual({
            kind: "redirect",
            segment: "budapest-keleti",
        });
        await expect(lookupStation("szolnok-005510017")).resolves.toEqual({
            kind: "redirect",
            segment: "budapest-keleti",
        });
    });

    it("gives a shared name to the domestic station, the id to others", async () => {
        stationsApi();
        await expect(lookupStation("buk")).resolves.toMatchObject({
            kind: "found",
            station: BUK_HU,
        });
        await expect(lookupStation("buk-005102723")).resolves.toEqual({
            kind: "found",
            station: BUK_PL,
            segment: "buk-005102723",
        });
        await expect(lookupStation("005102723")).resolves.toEqual({
            kind: "redirect",
            segment: "buk-005102723",
        });
    });

    it("is missing for unknown slugs and ids", async () => {
        stationsApi();
        await expect(lookupStation("nincs-ilyen")).resolves.toEqual({
            kind: "missing",
        });
        await expect(lookupStation("999999999")).resolves.toEqual({
            kind: "missing",
        });
    });

    it("fails loudly when the API is down, never a soft 404", async () => {
        api(() => [503, {}]);
        await expect(lookupStation("budapest-keleti")).rejects.toBeInstanceOf(
            ApiUnavailableError,
        );
    });
});

describe("directorySegments", () => {
    it("gives a shared slug to the lowest id", () => {
        expect(
            directorySegments([
                { id: "005510017", name: "Budapest-Keleti" },
                { id: "005615210", name: "Cestice" },
                { id: "005453210", name: "Čestice" },
            ]),
        ).toEqual(["budapest-keleti", "cestice-005615210", "cestice"]);
    });
});

describe("fetchTrainPage", () => {
    const history = {
        trainNumber: "650",
        tripShortName: "650 TOKAJ InterCity",
        runs: 20,
        stations: [],
    };

    it("is a train with history or a live run, else null", async () => {
        api((url) => {
            if (url.pathname === "/v1/trains") {
                return [200, { features: [] }];
            }
            if (url.pathname === "/v1/history/trains/650") {
                return [200, history];
            }
            return [200, { runs: 0, tripShortName: null, stations: [] }];
        });
        await expect(fetchTrainPage("650")).resolves.toEqual({
            history,
            vehicle: null,
        });
        await expect(fetchTrainPage("99999")).resolves.toBeNull();
        // Not a train number at all: no request
        await expect(fetchTrainPage("../x")).resolves.toBeNull();
    });

    it("takes today's run from the live feed", async () => {
        const vehicle = { vehicleId: "1:1", trip: { stoptimes: [] } };
        api((url) => {
            if (url.pathname === "/v1/trains") {
                return [
                    200,
                    {
                        features: [
                            {
                                properties: {
                                    vehicleId: "1:1",
                                    tripShortName: "7 KÖRÖS",
                                },
                            },
                        ],
                    },
                ];
            }
            if (decodeURIComponent(url.pathname) === "/v1/trains/1:1") {
                return [200, vehicle];
            }
            return [200, { runs: 0, tripShortName: null, stations: [] }];
        });
        await expect(fetchTrainPage("7")).resolves.toEqual({
            history: null,
            vehicle,
        });
    });

    it("knows train numbers", () => {
        expect(isTrainNumber("10")).toBe(true);
        expect(isTrainNumber("H8000")).toBe(true);
        expect(isTrainNumber("")).toBe(false);
        expect(isTrainNumber("10 TOKAJ")).toBe(false);
    });
});
