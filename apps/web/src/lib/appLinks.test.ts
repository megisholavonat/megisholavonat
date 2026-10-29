import { shareUrl } from "@megisholavonat/core/share";
import { describe, expect, it } from "vitest";
import { appleAppSiteAssociation, assetLinks } from "./appLinks";

type Component = {
    "/": string;
    "?"?: Record<string, string>;
    exclude?: boolean;
};

/** Apple's pattern syntax: `*` any run, `?` one character. */
function matches(pattern: string, value: string): boolean {
    const re = pattern
        .split("")
        .map((c) =>
            c === "*"
                ? ".*"
                : c === "?"
                  ? "."
                  : c.replace(/[.+^${}()|[\]\\/]/g, "\\$&"),
        )
        .join("");
    return new RegExp(`^${re}$`).test(value);
}

/** Whether iOS hands the link to the app: the first matching component. */
function opensApp(href: string): boolean {
    const url = new URL(href);
    const components = appleAppSiteAssociation.applinks.details[0]
        ?.components as Component[];
    for (const c of components) {
        if (!matches(c["/"], url.pathname)) continue;
        const query = Object.entries(c["?"] ?? {});
        if (
            !query.every(([key, pattern]) => {
                const value = url.searchParams.get(key);
                return value !== null && matches(pattern, value);
            })
        ) {
            continue;
        }
        return !c.exclude;
    }
    return false;
}

const site = "https://megisholavonat.info";

describe("apple-app-site-association", () => {
    it("names the app", () => {
        expect(appleAppSiteAssociation.applinks.details[0]?.appIDs).toEqual([
            "YMX8RUHNUC.info.megisholavonat.app",
        ]);
    });

    it("opens shared trains and stations in the app", () => {
        for (const locale of ["hu", "en"] as const) {
            expect(
                opensApp(shareUrl(site, locale, { vehicleId: "1:2_3" })),
            ).toBe(true);
            expect(
                opensApp(shareUrl(site, locale, { station: "005501024" })),
            ).toBe(true);
        }
        expect(opensApp(`${site}/?vehicleId=42`)).toBe(true);
        expect(opensApp(`${site}/en?station=1&utm_source=x`)).toBe(true);
    });

    it("leaves every other page on the web", () => {
        for (const path of [
            "/",
            "/hu",
            "/en?vehicleId=",
            "/hu/stats?vehicleId=1",
            "/en/privacy",
            "/hu/og/train/1",
            "/hu/stats/station/1?station=1",
            "/de?vehicleId=1",
        ]) {
            expect(opensApp(`${site}${path}`), path).toBe(false);
        }
    });
});

describe("assetlinks.json", () => {
    it("names the Android package", () => {
        expect(assetLinks[0]?.target.package_name).toBe(
            "info.megisholavonat.app",
        );
        expect(assetLinks[0]?.relation).toContain(
            "delegate_permission/common.handle_all_urls",
        );
    });
});
