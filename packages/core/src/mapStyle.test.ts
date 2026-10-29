import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import {
    createExpression,
    validateStyleMin,
} from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import {
    basemapStyle,
    NETWORK_SOURCE,
    networkLayer,
    STATION_TIER,
    STATIONS_SOURCE,
    stationLayers,
} from "./mapStyle";
import { MAP_PALETTE } from "./tokens/map";
import { type ColorScheme, DELAY_SCALE } from "./tokens/tokens";

const SCHEMES: ColorScheme[] = ["light", "dark"];

function luminance(hex: string): number {
    const h = hex.replace("#", "");
    const [r = 0, g = 0, b = 0] = [0, 2, 4].map((i) => {
        const c = Number.parseInt(h.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio */
function contrast(a: string, b: string): number {
    const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

/** The whole map as both clients draw it, sources included */
function fullStyle(scheme: ColorScheme, dim: boolean): StyleSpecification {
    const base = basemapStyle(scheme, "hu");
    const empty = {
        type: "geojson" as const,
        data: { type: "FeatureCollection" as const, features: [] },
    };
    const stations = stationLayers({ scheme, dim });
    return {
        ...base,
        sources: {
            ...base.sources,
            [NETWORK_SOURCE]: empty,
            [STATIONS_SOURCE]: empty,
        },
        layers: [
            ...base.layers,
            networkLayer({ scheme, dim }),
            ...stations.dots,
            ...stations.labels,
        ],
    };
}

describe("map style", () => {
    it.each(
        SCHEMES.flatMap(
            (s) =>
                [
                    [s, false],
                    [s, true],
                ] as const,
        ),
    )("is a valid MapLibre style (%s, dim %s)", (scheme, dim) => {
        expect(validateStyleMin(fullStyle(scheme, dim))).toEqual([]);
    });

    it("names places in the page's language", () => {
        const en = JSON.stringify(basemapStyle("light", "en").layers);
        const hu = JSON.stringify(basemapStyle("light", "hu").layers);
        expect(en).toContain("name_en");
        expect(hu).toContain("name:hu");
    });

    it("draws no POIs, shields or road names", () => {
        const symbols = basemapStyle("dark", "hu").layers.filter(
            (l) => l.type === "symbol",
        );
        expect(
            symbols.map((l) => ("source-layer" in l ? l["source-layer"] : "")),
        ).toEqual(["place", "place", "place", "place", "place", "water_name"]);
    });
});

describe("contrast on the land colour", () => {
    // Graphics ≥ 3:1 (WCAG 1.4.11), text ≥ 4.5:1
    it.each(SCHEMES)("%s: network, border and names read", (scheme) => {
        const p = MAP_PALETTE[scheme];
        expect(contrast(p.rail, p.land)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.railMinor, p.land)).toBeGreaterThanOrEqual(3);
        expect(contrast(p.border, p.land)).toBeGreaterThanOrEqual(3);
        expect(contrast(p.stationStroke, p.land)).toBeGreaterThanOrEqual(3);
        for (const text of [p.city, p.town, p.village, p.stationLabel]) {
            expect(contrast(text, p.land)).toBeGreaterThanOrEqual(4.5);
        }
        // Water is an area: it only has to differ from land, unlike today's
        // dark basemap (1.02:1)
        expect(contrast(p.water, p.land)).toBeGreaterThan(1.3);
    });

    it.each(SCHEMES)("%s: trains outweigh the network", (scheme) => {
        const p = MAP_PALETTE[scheme];
        // The network is neutral grey: only trains carry hue
        for (const hex of [p.rail, p.railMinor, p.track]) {
            const [r, g, b] = [1, 3, 5].map((i) =>
                Number.parseInt(hex.slice(i, i + 2), 16),
            );
            expect(
                Math.max(r ?? 0, g ?? 0, b ?? 0) -
                    Math.min(r ?? 0, g ?? 0, b ?? 0),
            ).toBeLessThanOrEqual(16);
        }
        expect(
            contrast(DELAY_SCALE[scheme].onTime.fill, p.land),
        ).toBeGreaterThanOrEqual(3);
    });
});

function evaluate(
    expression: unknown,
    properties: Record<string, unknown>,
    zoom = 10,
): unknown {
    const parsed = createExpression(expression, "test");
    if (parsed.result !== "success")
        throw new Error(JSON.stringify(parsed.value));
    return parsed.value.evaluate({ zoom }, {
        type: "Point",
        properties,
        geometry: [],
    } as never);
}

describe("station tiers", () => {
    const tier = (props: Record<string, unknown>) =>
        evaluate(STATION_TIER, { hev: 0, name: "X", ...props });

    it("ranks by trains a day", () => {
        expect(tier({ perDay: 400 })).toBe(1);
        expect(tier({ perDay: 80 })).toBe(1);
        expect(tier({ perDay: 79.9 })).toBe(2);
        expect(tier({ perDay: 15 })).toBe(3);
        expect(tier({ perDay: 0 })).toBe(4);
    });

    it("keeps HÉV and tram-train street stops to city zoom", () => {
        expect(tier({ perDay: 300, hev: 1, name: "Batthyány tér H" })).toBe(5);
        expect(tier({ perDay: 120, name: "Szeged, Anna-kút" })).toBe(5);
    });
});

describe("network", () => {
    it("is widest where most trains run, HÉV stays thin", () => {
        const width = networkLayer({ scheme: "light", dim: false }).paint as {
            "line-width": unknown;
        };
        const at = (n: number, hev = 0) =>
            evaluate(width["line-width"], { n, hev }, 12) as number;
        expect(at(120)).toBeGreaterThan(at(20));
        expect(at(20)).toBeGreaterThan(at(5));
        expect(at(200, 1)).toBe(at(5));
    });

    it("steps back in focus mode", () => {
        const paint = (dim: boolean) =>
            networkLayer({ scheme: "dark", dim }).paint as {
                "line-opacity": number;
            };
        expect(paint(true)["line-opacity"]).toBeLessThan(
            paint(false)["line-opacity"],
        );
        const labels = stationLayers({ scheme: "dark", dim: true }).labels;
        for (const l of labels) {
            expect(
                (l.paint as { "text-opacity": number })["text-opacity"],
            ).toBe(0);
        }
    });
});

describe("station names", () => {
    it("leave out the station named elsewhere", () => {
        const { labels } = stationLayers({
            scheme: "light",
            dim: false,
            namedElsewhere: "005510017",
        });
        for (const l of labels) {
            const filter = (l as { filter: unknown }).filter;
            const tier = Number(l.id.slice(-1));
            const at = (id: string) =>
                evaluate(filter, {
                    id,
                    hev: tier === 5 ? 1 : 0,
                    name: "X",
                    perDay: [400, 50, 20, 0, 0][tier - 1],
                });
            expect(at("005510017")).toBe(false);
            expect(at("005511296")).toBe(true);
        }
    });

    it("end where the railway overlay names stations", () => {
        const plain = stationLayers({ scheme: "light", dim: false });
        expect(plain.labels.every((l) => l.maxzoom === undefined)).toBe(true);
        const overlay = stationLayers({
            scheme: "light",
            dim: false,
            labelMaxZoom: 10.5,
            namedElsewhere: "1",
        });
        expect(overlay.labels.every((l) => l.maxzoom === 10.5)).toBe(true);
        const style = fullStyle("light", false);
        style.layers.push(
            ...overlay.labels.map((l) => ({ ...l, id: `${l.id}-x` })),
        );
        expect(validateStyleMin(style)).toEqual([]);
    });
});
