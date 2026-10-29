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
    routePaint,
    STATION_TIER,
    STATION_TYPE,
    STATIONS_SOURCE,
    stationLayers,
    stopImageId,
} from "./mapStyle";
import {
    MAP_PALETTE,
    MAP_VIEW,
    railwayOverlayPaint,
    railwayTileUrl,
} from "./tokens/map";
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
        evaluate(STATION_TIER, { type: "rail", hev: 0, name: "X", ...props });

    it("ranks by trains a day", () => {
        expect(tier({ perDay: 400 })).toBe(1);
        expect(tier({ perDay: 80 })).toBe(1);
        expect(tier({ perDay: 79.9 })).toBe(2);
        expect(tier({ perDay: 15 })).toBe(3);
        expect(tier({ perDay: 0 })).toBe(4);
    });

    it("keeps HÉV, tram-train and Children's Railway stops to city zoom", () => {
        expect(tier({ perDay: 300, type: "hev", name: "Batthyány tér" })).toBe(
            5,
        );
        expect(tier({ perDay: 120, type: "tramtrain" })).toBe(5);
        expect(tier({ perDay: 4, type: "childrens_railway" })).toBe(5);
        // A railway station is ranked by its trains, whatever its name
        expect(tier({ perDay: 120, name: "Szeged, Anna-kút" })).toBe(1);
    });

    it("reads files from before the type, by their HÉV flag", () => {
        const old = (props: Record<string, unknown>) =>
            evaluate(STATION_TYPE, props);
        expect(old({ hev: 1 })).toBe("hev");
        expect(old({ hev: 0 })).toBe("rail");
        expect(old({ hev: 0, type: "tramtrain" })).toBe("tramtrain");
    });
});

describe("station marks", () => {
    const { dots } = stationLayers({ scheme: "dark", dim: false });
    const matches = (layer: (typeof dots)[number], type: string) =>
        evaluate((layer as { filter: unknown }).filter, {
            type,
            hev: 0,
            name: "X",
            perDay: 0,
        });
    const shape = dots.find((l) => l.id === "mhav-station-shape");

    it("draw HÉV and tram-train stops in their vehicles' shape", () => {
        expect(shape?.type).toBe("symbol");
        const layout = shape?.layout as { "icon-image": unknown };
        const image = (type: string) =>
            evaluate(layout["icon-image"], { type, hev: 0 }, 13);
        expect(image("hev")).toBe(stopImageId("dark", "square"));
        expect(image("tramtrain")).toBe(stopImageId("dark", "tramtrain"));
        for (const type of ["hev", "tramtrain"]) {
            expect(shape && matches(shape, type)).toBe(true);
            const circles = dots.filter((l) => l.type === "circle");
            expect(circles.some((l) => matches(l, type))).toBe(false);
        }
    });

    it("keep railway and Children's Railway stations round", () => {
        expect(shape && matches(shape, "rail")).toBe(false);
        expect(shape && matches(shape, "childrens_railway")).toBe(false);
        expect(
            dots.filter((l) => l.type === "circle" && matches(l, "rail")),
        ).toHaveLength(1);
        expect(
            dots.filter(
                (l) => l.type === "circle" && matches(l, "childrens_railway"),
            ),
        ).toHaveLength(1);
    });

    it("grow with the dots they stand for", () => {
        const layout = shape?.layout as { "icon-size": unknown };
        const at = (z: number) =>
            evaluate(layout["icon-size"], { type: "hev" }, z) as number;
        expect(at(12)).toBeLessThan(at(15));
        expect(at(15)).toBeCloseTo(10 / 9);
    });
});

describe("shared with the app", () => {
    it("inverts the railway overlay in dark only", () => {
        expect(railwayOverlayPaint("dark")["raster-hue-rotate"]).toBe(180);
        expect(railwayOverlayPaint("light")["raster-hue-rotate"]).toBe(
            undefined,
        );
    });

    it("takes the railway tiles through the tile cache when set", () => {
        expect(railwayTileUrl()).toContain("tiles.openrailwaymap.org");
        expect(railwayTileUrl("https://cache.example/")).toBe(
            "https://cache.example/orm/{z}/{x}/{y}.png",
        );
    });

    it("keeps one camera range", () => {
        const [w, s, e, n] = MAP_VIEW.bounds;
        for (const { center } of Object.values(MAP_VIEW.initial)) {
            expect(center[0]).toBeGreaterThan(w);
            expect(center[0]).toBeLessThan(e);
            expect(center[1]).toBeGreaterThan(s);
            expect(center[1]).toBeLessThan(n);
        }
    });

    it.each(SCHEMES)("%s: the route's layers are valid", (scheme) => {
        const r = routePaint(scheme);
        const style = fullStyle(scheme, false);
        const geo = {
            type: "geojson" as const,
            data: { type: "FeatureCollection" as const, features: [] },
        };
        style.sources.route = geo;
        style.layers.push(
            { id: "c", type: "line", source: "route", ...r.casing },
            { id: "l", type: "line", source: "route", ...r.line },
            { id: "s", type: "circle", source: "route", ...r.stops },
            { id: "t", type: "symbol", source: "route", ...r.stopLabels },
        );
        expect(validateStyleMin(style)).toEqual([]);
        const fill = (passed?: boolean) =>
            evaluate(r.stops.paint["circle-color"], { passed });
        expect(fill(true)).not.toEqual(fill(false));
        expect(fill(undefined)).toEqual(fill(false));
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
                    type: tier === 5 ? "hev" : "rail",
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
