import { afterEach, describe, expect, it, vi } from "vitest";
import { stationName, trainTitle } from "./lookup";

function answer(status: number, body: unknown = {}) {
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify(body), { status })),
    );
}

afterEach(() => vi.unstubAllGlobals());

describe("trainTitle", () => {
    it("names a train with runs on record", async () => {
        answer(200, { runs: 12, tripShortName: "650 TOKAJ InterCity" });
        await expect(trainTitle("650")).resolves.toBe("650 TOKAJ");
    });

    it("has no title for a number never seen (a 404 page)", async () => {
        // The API answers 200 with no runs and no name for "abc"
        answer(200, { runs: 0, tripShortName: null, stations: [] });
        await expect(trainTitle("abc")).resolves.toBeNull();
        answer(422);
        await expect(trainTitle("x".repeat(400))).resolves.toBeNull();
    });

    it("keeps the page when the API cannot be asked", async () => {
        answer(503);
        await expect(trainTitle("650")).resolves.toBe("650");
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new TypeError("fetch failed");
            }),
        );
        await expect(trainTitle("650")).resolves.toBe("650");
    });
});

describe("stationName", () => {
    it("is the board's station, null when unknown", async () => {
        answer(200, { station: { name: "Szolnok" }, entries: [] });
        await expect(stationName("005513748")).resolves.toBe("Szolnok");
        answer(404, { detail: "Not Found" });
        await expect(stationName("999")).resolves.toBeNull();
        answer(500);
        await expect(stationName("999")).resolves.toBeUndefined();
    });
});
