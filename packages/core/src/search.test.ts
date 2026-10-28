import { describe, expect, it } from "vitest";
import { matchesMavRoute } from "./mavRoutes";
import { normalizeSearchText } from "./search";

describe("normalizeSearchText", () => {
    it("strips Hungarian diacritics and lowercases", () => {
        expect(normalizeSearchText("Győr")).toBe("gyor");
        expect(normalizeSearchText("ŐSZ")).toBe("osz");
    });
});

describe("matchesMavRoute", () => {
    it.each([
        "s10",
        "S 10",
        "s-10",
    ])("matches the S10 route icon entity against %j", (query) => {
        expect(matchesMavRoute("&#335;", query)).toBe(true);
        expect(matchesMavRoute("&#x14F;", query)).toBe(true);
    });

    it("does not match a different route", () => {
        expect(matchesMavRoute("&#335;", "s20")).toBe(false);
    });

    it("never matches an empty query or route", () => {
        expect(matchesMavRoute("&#335;", "  ")).toBe(false);
        expect(matchesMavRoute(null, "s10")).toBe(false);
    });
});
