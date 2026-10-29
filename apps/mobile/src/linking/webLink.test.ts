import { shareUrl } from "@megisholavonat/core/links";
import { describe, expect, it } from "vitest";
import { WEB_URL } from "../config";
import { webLinkPath } from "./webLink";

describe("webLinkPath", () => {
    it("opens a shared train", () => {
        expect(webLinkPath(shareUrl(WEB_URL, "hu", { vehicleId: "1:2" }))).toBe(
            "/train/1%3A2",
        );
        expect(webLinkPath(shareUrl(WEB_URL, "en", { vehicleId: "42" }))).toBe(
            "/train/42",
        );
    });

    it("opens a shared station", () => {
        expect(
            webLinkPath(shareUrl(WEB_URL, "hu", { station: "005501024" })),
        ).toBe("/station/005501024");
        expect(webLinkPath(`${WEB_URL}/en/?station=a%20b`)).toBe(
            "/station/a%20b",
        );
    });

    it("takes a link without a locale", () => {
        expect(webLinkPath(`${WEB_URL}/?vehicleId=42`)).toBe("/train/42");
        expect(webLinkPath(`${WEB_URL}?station=7`)).toBe("/station/7");
    });

    it("ignores unknown params", () => {
        expect(
            webLinkPath(`${WEB_URL}/hu?utm_source=x&vehicleId=42&fbclid=y`),
        ).toBe("/train/42");
        expect(webLinkPath(`${WEB_URL}/hu?foo=bar`)).toBe("/");
        expect(webLinkPath(`${WEB_URL}/hu?vehicleId=`)).toBe("/");
    });

    it("opens a shared journey in the planner", () => {
        expect(
            webLinkPath(
                `${WEB_URL}/hu?from=budapest&to=005501289&time=2026-10-30T07:00&utm_source=x`,
            ),
        ).toBe("/journey?from=budapest&to=005501289&time=2026-10-30T07%3A00");
        expect(webLinkPath(`${WEB_URL}/en?to=005517228&arriveBy=1`)).toBe(
            "/journey?to=005517228",
        );
        expect(webLinkPath(`${WEB_URL}/hu?time=2026-10-30T07:00`)).toBe("/");
    });

    it("prefers the train when a link has both", () => {
        expect(webLinkPath(`${WEB_URL}/hu?station=7&vehicleId=42`)).toBe(
            "/train/42",
        );
    });

    it("opens the map for other pages of the site", () => {
        expect(webLinkPath(`${WEB_URL}/hu/stats?vehicleId=42`)).toBe("/");
        expect(webLinkPath(`${WEB_URL}/en/privacy`)).toBe("/");
        expect(webLinkPath(`${WEB_URL}/de?vehicleId=42`)).toBe("/");
    });

    it("leaves app scheme links and other sites alone", () => {
        for (const url of [
            "megisholavonat://train/42",
            "/train/42",
            "https://example.com/hu?vehicleId=42",
            "https://dev.megisholavonat.info/hu?vehicleId=42",
        ]) {
            expect(webLinkPath(url)).toBe(url);
        }
    });
});
