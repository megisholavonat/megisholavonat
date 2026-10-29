import { afterEach, describe, expect, it, vi } from "vitest";
import { apiUrl, DEV_API_URL, fetchTrain, siteUrl } from "./server";

describe("apiUrl", () => {
    it("takes the API from API_URL only", () => {
        expect(apiUrl({ API_URL: "http://api.mhav.svc:8000/" })).toBe(
            "http://api.mhav.svc:8000",
        );
        expect(apiUrl({})).toBe(DEV_API_URL);
    });

    it("falls back to the dev API on a value that is not an http URL", () => {
        expect(apiUrl({ API_URL: "not a url" })).toBe(DEV_API_URL);
        expect(apiUrl({ API_URL: "file:///etc/passwd" })).toBe(DEV_API_URL);
    });
});

describe("siteUrl", () => {
    it("is the public origin from SITE_URL", () => {
        expect(siteUrl({})).toBe("https://megisholavonat.info");
        expect(siteUrl({ SITE_URL: "https://dev.megisholavonat.info/" })).toBe(
            "https://dev.megisholavonat.info",
        );
        expect(siteUrl({ SITE_URL: "a.example, b.example" })).toBe(
            "https://megisholavonat.info",
        );
    });
});

describe("fetchTrain", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it("asks the configured API, whatever host the request came for", async () => {
        vi.stubEnv("API_URL", "http://api.mhav.svc:8000");
        const seen: string[] = [];
        vi.stubGlobal("fetch", async (url: string) => {
            seen.push(String(url));
            return new Response("{}", { status: 404 });
        });
        expect(await fetchTrain("1:2/../x")).toBeNull();
        expect(seen).toEqual([
            "http://api.mhav.svc:8000/v1/trains/1%3A2%2F..%2Fx",
        ]);
    });

    it("returns null when the API cannot be reached", async () => {
        vi.stubGlobal("fetch", async () => {
            throw new TypeError("fetch failed");
        });
        expect(await fetchTrain("1")).toBeNull();
    });
});
