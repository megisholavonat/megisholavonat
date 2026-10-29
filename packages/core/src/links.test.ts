import { describe, expect, it } from "vitest";
import {
    delaySummaryPath,
    delaySummaryUrl,
    isMapPath,
    mapParams,
    mapPath,
    mapTarget,
    ogImagePath,
    pageAlternates,
    parseStationSegment,
    plannerLink,
    plannerSearch,
    shareUrl,
    stationHref,
    stationSegment,
    stationSlug,
    statsPath,
    trainPath,
} from "./links";

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

const SZOLNOK = "005513748";

describe("map links", () => {
    it("links a train or a station under the locale", () => {
        expect(
            shareUrl("https://megisholavonat.info/", "hu", {
                vehicleId: "1:918061939438",
            }),
        ).toBe("https://megisholavonat.info/hu?vehicleId=1%3A918061939438");
        expect(
            shareUrl("http://localhost:3000", "en", { station: "005510017" }),
        ).toBe("http://localhost:3000/en?station=005510017");
        expect(mapPath("hu")).toBe("/hu");
        expect(mapPath("en", null)).toBe("/en");
    });

    it("reads a link back, trimmed, the train first", () => {
        expect(
            mapTarget(new URLSearchParams("?vehicleId=1%3A915504313395")),
        ).toEqual({
            vehicleId: "1:915504313395",
        });
        expect(
            mapTarget(new URLSearchParams("?station=1&vehicleId=2")),
        ).toEqual({
            vehicleId: "2",
        });
        expect(
            mapTarget(new URLSearchParams("?vehicleId=%20&station=%207%20")),
        ).toEqual({
            station: "7",
        });
        expect(mapTarget(new URLSearchParams("?vehicleId="))).toBeNull();
        expect(
            mapParams(new URLSearchParams("?station=7&vehicleId=42")),
        ).toEqual({
            vehicleId: "42",
            station: "7",
        });
    });

    it("knows the map page's paths", () => {
        for (const path of ["/", "/hu", "/en", "/hu/"]) {
            expect(isMapPath(path)).toBe(true);
        }
        for (const path of ["/de", "/hu/stats", "/en/privacy", ""]) {
            expect(isMapPath(path)).toBe(false);
        }
    });
});

describe("page links", () => {
    it("builds the delay card, keeping valid stops only", () => {
        expect(
            delaySummaryPath("hu", "2614", "2026-10-29", {
                from: SZOLNOK,
                to: "x<y",
            }),
        ).toBe(`/hu/kesesek/2614/2026-10-29?from=${SZOLNOK}`);
        expect(delaySummaryPath("en", "H8000", "2026-10-29")).toBe(
            "/en/kesesek/H8000/2026-10-29",
        );
        expect(
            delaySummaryUrl(
                "https://megisholavonat.info/",
                "hu",
                "10",
                "2026-10-28",
            ),
        ).toBe("https://megisholavonat.info/hu/kesesek/10/2026-10-28");
        expect(statsPath("en")).toBe("/en/stats");
    });

    it("builds preview image paths", () => {
        expect(ogImagePath("hu", null)).toBe("/hu/og");
        expect(ogImagePath("hu", null, 5)).toBe("/hu/og");
        expect(ogImagePath("hu", { vehicleId: "1:42" }, 5)).toBe(
            "/hu/og/train/1%3A42?v=5",
        );
        expect(ogImagePath("en", { station: SZOLNOK })).toBe(
            `/en/og/station/${SZOLNOK}`,
        );
        expect(
            ogImagePath("hu", {
                run: {
                    number: "2614",
                    date: "2026-10-29",
                    stops: { from: SZOLNOK },
                },
            }),
        ).toBe(`/hu/og/run/2614/2026-10-29?from=${SZOLNOK}`);
    });
});

describe("planner links", () => {
    const read = (search: string) => plannerLink(new URLSearchParams(search));

    it("round-trips a journey", () => {
        const journey = read(
            "from=budapest&to=005501289&time=2026-10-30T07:00&arriveBy=1",
        );
        expect(journey).toEqual({
            from: "budapest",
            to: "005501289",
            time: "2026-10-30T07:00",
            arriveBy: true,
        });
        expect(journey && plannerSearch(journey)).toEqual({
            from: "budapest",
            to: "005501289",
            time: "2026-10-30T07:00",
            arriveBy: "1",
        });
    });

    it("drops what is not a station or a time", () => {
        expect(read("vehicleId=42")).toBeNull();
        expect(read("from=keleti&to=x")).toBeNull();
        expect(read("to=005517228&time=now&arriveBy=1")).toEqual({
            from: null,
            to: "005517228",
            time: null,
            arriveBy: false,
        });
    });
});
