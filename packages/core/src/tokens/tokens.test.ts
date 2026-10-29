import { describe, expect, it } from "vitest";
import type { DelayLevel } from "../delay";
import { darkTheme, lightTheme } from "./native";
import {
    COLORS,
    type ColorScheme,
    DELAY_SCALE,
    MARKER,
    STALE_COLORS,
} from "./tokens";
import { cssVariables, themeCss } from "./web";

/** WCAG 2 relative luminance of an opaque #RRGGBB colour. */
function luminance(hex: string): number {
    const match = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!match?.[1]) throw new Error(`not an opaque hex colour: ${hex}`);
    const channels = [0, 2, 4].map((i) => {
        const c = Number.parseInt(match[1]?.slice(i, i + 2) ?? "", 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    const [r = 0, g = 0, b = 0] = channels;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const SCHEMES: ColorScheme[] = ["light", "dark"];
const LEVELS: DelayLevel[] = ["onTime", "slight", "moderate", "severe"];
const cases = SCHEMES.flatMap((scheme) =>
    LEVELS.map((level) => [scheme, level] as const),
);

describe("contrast helper", () => {
    it("matches the WCAG extremes", () => {
        expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
        expect(contrast("#777777", "#777777")).toBe(1);
    });
});

describe("delay text", () => {
    it.each(cases)("%s %s text is ≥4.5:1 on surface", (scheme, level) => {
        const { text } = DELAY_SCALE[scheme][level];
        expect(contrast(text, COLORS[scheme].surface)).toBeGreaterThanOrEqual(
            4.5,
        );
    });

    it.each(SCHEMES)("%s stale text is ≥4.5:1 on surface", (scheme) => {
        expect(
            contrast(STALE_COLORS[scheme].text, COLORS[scheme].surface),
        ).toBeGreaterThanOrEqual(4.5);
    });
});

describe("marker fill", () => {
    it.each(
        cases,
    )("%s %s fill is ≥3:1 against the map or its outline", (scheme, level) => {
        const { fill, outline } = DELAY_SCALE[scheme][level];
        const map = COLORS[scheme].map;
        const best = Math.max(
            contrast(fill, map),
            // The outline ring sits between fill and map
            Math.min(
                contrast(fill, outline.color),
                contrast(outline.color, map),
            ),
        );
        expect(best).toBeGreaterThanOrEqual(3);
    });

    it("yellow and orange get a dark outline in light mode", () => {
        for (const level of ["slight", "moderate"] as const) {
            const { fill, outline } = DELAY_SCALE.light[level];
            expect(contrast(fill, COLORS.light.map)).toBeLessThan(3);
            expect(outline.color).toBe(COLORS.light.ink);
        }
    });

    it.each(cases)("%s %s label is ≥4.5:1 on its fill", (scheme, level) => {
        const { fill, label } = DELAY_SCALE[scheme][level];
        // On time is an unlabelled circle
        if (level === "onTime") return;
        expect(contrast(label, fill)).toBeGreaterThanOrEqual(4.5);
    });

    it.each(SCHEMES)("%s stale outline is ≥3:1 against the map", (scheme) => {
        expect(
            contrast(STALE_COLORS[scheme].outline.color, COLORS[scheme].map),
        ).toBeGreaterThanOrEqual(3);
    });
});

describe("marker spec", () => {
    it("grows with the delay", () => {
        const sizes = LEVELS.map((level) => MARKER.levels[level]);
        for (let i = 1; i < sizes.length; i++) {
            expect(sizes[i]?.dot).toBeGreaterThan(sizes[i - 1]?.dot ?? 0);
            expect(sizes[i]?.height).toBeGreaterThan(sizes[i - 1]?.height ?? 0);
        }
    });

    it("labels delays as +N and stale trains as minutes", () => {
        expect(MARKER.label.delayed(7)).toBe("+7");
        expect(MARKER.label.stale(6.4)).toBe("6′");
    });
});

describe("adapters", () => {
    it("emits the same variable names for both schemes", () => {
        expect(Object.keys(cssVariables("dark"))).toEqual(
            Object.keys(cssVariables("light")),
        );
        expect(cssVariables("light")["--mhav-delay-on-time-text"]).toBe(
            "#0B5FB8",
        );
    });

    it("puts light and static variables on :root, dark on .dark", () => {
        const css = themeCss();
        expect(css).toMatch(/^:root\{.*--mhav-surface-2:#ECEEF1;/);
        expect(css).toContain("--mhav-delay-severe-text-on-dark:#FF7B72;");
        expect(css).toContain("--mhav-radius-sm:6px;");
        expect(css).toContain(".dark{");
        expect(css).not.toContain("undefined");
    });

    it("gives React Native plain style objects", () => {
        expect(lightTheme.colors.surface).toBe("#FFFFFF");
        expect(darkTheme.delay.severe.fill).toBe("#F2453D");
        expect(darkTheme.type.delayXl).toEqual({
            fontSize: 40,
            lineHeight: 44,
            fontWeight: "800",
        });
    });
});
