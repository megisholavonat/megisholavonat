import { describe, expect, it } from "vitest";
import {
    pageAlternates,
    parseStationSegment,
    stationHref,
    stationSegment,
    stationSlug,
    trainPath,
} from "./paths";

describe("stationSlug", () => {
    it("folds accents and joins words with single dashes", () => {
        expect(stationSlug("Budapest-Keleti")).toBe("budapest-keleti");
        expect(stationSlug("Szeged-Rókus")).toBe("szeged-rokus");
        expect(stationSlug("Győr")).toBe("gyor");
        expect(stationSlug("Őriszentpéter")).toBe("oriszentpeter");
        expect(stationSlug("Batthyány tér H")).toBe("batthyany-ter-h");
        expect(stationSlug("Margit híd, budai hídfő H")).toBe(
            "margit-hid-budai-hidfo-h",
        );
        expect(stationSlug("Kostrzyn (Gr)")).toBe("kostrzyn-gr");
        expect(stationSlug("  Hodos Gr. ")).toBe("hodos-gr");
    });
});

describe("station segments", () => {
    it("reads a bare slug, a slug with an id and a bare id", () => {
        expect(parseStationSegment("budapest-keleti")).toEqual({
            slug: "budapest-keleti",
            id: null,
        });
        expect(parseStationSegment("buk-005102723")).toEqual({
            slug: "buk",
            id: "005102723",
        });
        expect(parseStationSegment("005510017")).toEqual({
            slug: "",
            id: "005510017",
        });
        // Short numbers are part of a name ("Km. 49 800")
        expect(parseStationSegment("km-49-800")).toEqual({
            slug: "km-49-800",
            id: null,
        });
    });

    it("adds the id only to a station whose name is taken", () => {
        const buk = { id: "005102723", name: "Buk" };
        expect(stationSegment(buk, false)).toBe("buk");
        expect(stationSegment(buk, true)).toBe("buk-005102723");
        expect(parseStationSegment(stationSegment(buk, true)).id).toBe(buk.id);
    });
});

describe("paths", () => {
    it("uses each language's own words", () => {
        const keleti = { id: "005510017", name: "Budapest-Keleti" };
        expect(stationHref("hu", keleti)).toBe("/hu/allomas/budapest-keleti");
        expect(stationHref("en", keleti)).toBe("/en/station/budapest-keleti");
        expect(trainPath("hu", "10")).toBe("/hu/vonat/10");
        expect(trainPath("en", "H8000")).toBe("/en/train/H8000");
    });

    it("lists every language version, Hungarian as the default", () => {
        expect(pageAlternates("https://m.info", "train", "650")).toEqual({
            hu: "https://m.info/hu/vonat/650",
            en: "https://m.info/en/train/650",
            "x-default": "https://m.info/hu/vonat/650",
        });
    });
});
