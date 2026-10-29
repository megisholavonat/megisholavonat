import type { ColorScheme } from "@megisholavonat/core/tokens";
import { type Flavor, layers, namedFlavor } from "@protomaps/basemaps";
import type {
    ExpressionSpecification,
    LayerSpecification,
    SourceSpecification,
    StyleSpecification,
} from "maplibre-gl";
import {
    basemapTransform,
    SLOTS,
    STYLE_URLS,
} from "@/components/map/basemapStyle";
import { type Palette, QUIET, TRANSIT } from "./palettes";

export type Basemap = "current" | "quiet" | "transit" | "protomaps";

const OFM_GLYPHS =
    "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
const OFM_TILES = "https://tiles.openfreemap.org/planet";
/**
 * Hungary and its border areas from the daily Protomaps build, cut with
 * `pmtiles extract` and served by `pmtiles serve` (in production: the tile
 * cache). Outside the extract the Protomaps variant is blank.
 */
export const PMTILES_URL =
    process.env.NEXT_PUBLIC_MAP_LAB_PMTILES_URL ??
    "http://localhost:3478/hu.json";

const BASE_KEY = "mhav:base";
const REGULAR = ["Noto Sans Regular"];
const BOLD = ["Noto Sans Bold"];
const ITALIC = ["Noto Sans Italic"];

type Expr = ExpressionSpecification;
const zoom = (...stops: number[]): Expr =>
    ["interpolate", ["linear"], ["zoom"], ...stops] as unknown as Expr;
const name = (locale: string): Expr =>
    locale === "en"
        ? ["coalesce", ["get", "name_en"], ["get", "name"]]
        : ["coalesce", ["get", `name:${locale}`], ["get", "name"]];

/**
 * Our own style over OpenFreeMap's OpenMapTiles vectors: land, water,
 * borders, quiet roads and place names, nothing else (no POIs, shields, road
 * names, house numbers or hillshade).
 */
function ofmStyle(
    p: Palette,
    locale: string,
    transit: boolean,
): StyleSpecification {
    const src = "openmaptiles";
    const roads = (classes: string[]): Expr =>
        [
            "all",
            ["match", ["get", "class"], classes, true, false],
            ["!=", ["get", "brunnel"], "tunnel"],
        ] as unknown as Expr;
    const l: LayerSpecification[] = [
        {
            id: "background",
            type: "background",
            paint: { "background-color": p.land },
        },
        {
            id: "urban",
            type: "fill",
            source: src,
            "source-layer": "landuse",
            filter: [
                "match",
                ["get", "class"],
                [
                    "residential",
                    "suburb",
                    "neighbourhood",
                    "commercial",
                    "industrial",
                    "retail",
                ],
                true,
                false,
            ],
            paint: {
                "fill-color": p.urban,
                "fill-opacity": zoom(5, 0.6, 9, 1),
            },
        },
        {
            id: "park",
            type: "fill",
            source: src,
            "source-layer": "park",
            minzoom: 9,
            paint: {
                "fill-color": p.park,
                "fill-opacity": zoom(9, 0, 10, 0.8),
            },
        },
        {
            id: "waterway",
            type: "line",
            source: src,
            "source-layer": "waterway",
            filter: [
                "all",
                ["!=", ["get", "brunnel"], "tunnel"],
                [
                    "any",
                    ["==", ["get", "class"], "river"],
                    [">=", ["zoom"], 12],
                ],
            ],
            paint: {
                "line-color": p.waterLine,
                "line-width": zoom(6, 0.6, 10, 1.4, 14, 3),
            },
        },
        {
            id: "water",
            type: "fill",
            source: src,
            "source-layer": "water",
            filter: ["!=", ["get", "brunnel"], "tunnel"],
            paint: { "fill-color": p.water },
        },
        {
            id: "building",
            type: "fill",
            source: src,
            "source-layer": "building",
            minzoom: 14,
            paint: {
                "fill-color": p.roadCasing,
                "fill-opacity": transit ? 0.35 : 0.6,
            },
        },
        // Roads: casing only where they are wide enough to need it
        {
            id: "road-minor",
            type: "line",
            source: src,
            "source-layer": "transportation",
            minzoom: transit ? 13 : 12,
            filter: roads(["minor", "tertiary", "service"]),
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
                "line-color": p.road,
                "line-width": zoom(12, 0.5, 14, 2, 16, 6),
            },
        },
        {
            id: "road-major-casing",
            type: "line",
            source: src,
            "source-layer": "transportation",
            minzoom: 11,
            filter: roads(["primary", "secondary", "trunk"]),
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
                "line-color": p.roadCasing,
                "line-width": zoom(11, 1.5, 14, 5, 16, 11),
            },
        },
        {
            id: "road-major",
            type: "line",
            source: src,
            "source-layer": "transportation",
            minzoom: transit ? 8 : 7,
            filter: roads(
                transit
                    ? ["primary", "trunk"]
                    : ["primary", "secondary", "trunk"],
            ),
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
                "line-color": p.road,
                "line-width": zoom(7, 0.4, 11, 1, 14, 3.5, 16, 9),
            },
        },
        {
            id: "motorway-casing",
            type: "line",
            source: src,
            "source-layer": "transportation",
            minzoom: 6,
            filter: roads(["motorway"]),
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
                "line-color": p.motorwayCasing,
                "line-width": zoom(6, 1, 10, 2.5, 14, 6, 16, 13),
            },
        },
        {
            id: "motorway",
            type: "line",
            source: src,
            "source-layer": "transportation",
            minzoom: 9,
            filter: roads(["motorway"]),
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
                "line-color": p.motorway,
                "line-width": zoom(9, 0.6, 10, 1.4, 14, 4, 16, 10),
            },
        },
        // Borders on top of roads and water: a soft halo, then the line
        {
            id: "border-halo",
            type: "line",
            source: src,
            "source-layer": "boundary",
            filter: [
                "all",
                ["==", ["get", "admin_level"], 2],
                ["!=", ["get", "maritime"], 1],
            ],
            layout: { "line-join": "round" },
            paint: {
                "line-color": p.borderHalo,
                "line-width": zoom(4, 3, 8, 5, 12, 8),
            },
        },
        {
            id: "border",
            type: "line",
            source: src,
            "source-layer": "boundary",
            filter: [
                "all",
                ["==", ["get", "admin_level"], 2],
                ["!=", ["get", "maritime"], 1],
            ],
            layout: { "line-join": "round" },
            paint: {
                "line-color": p.border,
                "line-width": zoom(4, 1, 8, 1.5, 12, 2),
                "line-dasharray": [4, 1.5],
            },
        },
        // Labels: water, then places from small to large (large wins)
        {
            id: "water-name",
            type: "symbol",
            source: src,
            "source-layer": "water_name",
            minzoom: 8,
            filter: ["==", ["geometry-type"], "Point"],
            layout: {
                "text-field": name(locale),
                "text-font": ITALIC,
                "text-size": 12,
            },
            paint: {
                "text-color": p.waterLabel,
                "text-halo-color": p.water,
                "text-halo-width": 1,
            },
        },
        {
            id: "place-village",
            type: "symbol",
            source: src,
            "source-layer": "place",
            minzoom: transit ? 11 : 10,
            filter: [
                "match",
                ["get", "class"],
                ["village", "suburb", "quarter"],
                true,
                false,
            ],
            layout: {
                "text-field": name(locale),
                "text-font": REGULAR,
                "text-size": zoom(10, 11, 14, 13),
                "text-max-width": 8,
            },
            paint: {
                "text-color": p.village,
                "text-halo-color": p.halo,
                "text-halo-width": 1.5,
            },
        },
        {
            id: "place-town",
            type: "symbol",
            source: src,
            "source-layer": "place",
            minzoom: transit ? 9 : 8,
            filter: ["==", ["get", "class"], "town"],
            layout: {
                "text-field": name(locale),
                "text-font": REGULAR,
                "text-size": zoom(8, 11, 12, 14),
                "text-max-width": 8,
            },
            paint: {
                "text-color": p.town,
                "text-halo-color": p.halo,
                "text-halo-width": 1.5,
            },
        },
        {
            id: "place-city",
            type: "symbol",
            source: src,
            "source-layer": "place",
            minzoom: 5,
            maxzoom: 14,
            filter: ["==", ["get", "class"], "city"],
            layout: {
                "text-field": name(locale),
                "text-font": BOLD,
                "text-size": zoom(5, 11, 8, 13, 12, 17),
                "text-max-width": 8,
                "symbol-sort-key": ["coalesce", ["get", "rank"], 10],
            },
            paint: {
                "text-color": p.city,
                "text-halo-color": p.halo,
                "text-halo-width": 1.5,
            },
        },
        {
            id: "place-country",
            type: "symbol",
            source: src,
            "source-layer": "place",
            maxzoom: 9,
            filter: ["==", ["get", "class"], "country"],
            layout: {
                "text-field": name(locale),
                "text-font": REGULAR,
                "text-size": zoom(4, 11, 8, 14),
                "text-transform": "uppercase",
                "text-letter-spacing": 0.15,
            },
            paint: {
                "text-color": p.country,
                "text-halo-color": p.halo,
                "text-halo-width": 1.5,
            },
        },
    ];
    return {
        version: 8,
        name: transit ? "MHaV transit" : "MHaV quiet",
        glyphs: OFM_GLYPHS,
        sources: {
            [src]: { type: "vector", url: OFM_TILES },
        },
        layers: l,
    };
}

/**
 * Protomaps' own layer set (BSD-3), recoloured with our palette, over a
 * Hungary extract we host ourselves.
 */
function protomapsStyle(
    p: Palette,
    scheme: ColorScheme,
    locale: string,
): StyleSpecification {
    const base = namedFlavor(scheme === "dark" ? "dark" : "light");
    const flavor: Flavor = {
        ...base,
        background: p.land,
        earth: p.land,
        park_a: p.park,
        park_b: p.park,
        wood_a: p.land,
        wood_b: p.land,
        scrub_a: p.land,
        scrub_b: p.land,
        industrial: p.urban,
        hospital: p.urban,
        school: p.urban,
        pedestrian: p.urban,
        military: p.urban,
        zoo: p.park,
        water: p.water,
        buildings: p.roadCasing,
        minor_a: p.road,
        minor_b: p.road,
        minor_service: p.road,
        link: p.road,
        major: p.road,
        highway: p.motorway,
        minor_casing: p.roadCasing,
        minor_service_casing: p.roadCasing,
        link_casing: p.roadCasing,
        major_casing_early: p.roadCasing,
        major_casing_late: p.roadCasing,
        highway_casing_early: p.motorwayCasing,
        highway_casing_late: p.motorwayCasing,
        railway: p.track,
        boundaries: p.border,
        city_label: p.city,
        city_label_halo: p.halo,
        subplace_label: p.village,
        subplace_label_halo: p.halo,
        state_label: p.region,
        state_label_halo: p.halo,
        country_label: p.country,
        roads_label_minor: p.village,
        roads_label_minor_halo: p.halo,
        roads_label_major: p.village,
        roads_label_major_halo: p.halo,
        regular: REGULAR[0],
        bold: BOLD[0],
        italic: ITALIC[0],
        pois: undefined,
    };
    const all = layers("protomaps", flavor, { lang: locale }).map(
        (layer): LayerSpecification =>
            // The same clear, dashed country border as our OFM styles
            layer.id === "boundaries_country" && layer.type === "line"
                ? {
                      ...layer,
                      paint: {
                          "line-color": p.border,
                          "line-width": zoom(4, 1, 8, 1.5, 12, 2),
                          "line-dasharray": [4, 1.5],
                      },
                  }
                : layer,
    );
    return {
        version: 8,
        name: "MHaV protomaps",
        glyphs: OFM_GLYPHS,
        sources: {
            protomaps: {
                type: "vector",
                url: PMTILES_URL,
                attribution:
                    '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>',
            } as SourceSpecification,
        },
        // No POI icons (no sprite) and no road names: a train map
        layers: all.filter(
            (layer) =>
                !layer.id.startsWith("pois") &&
                !layer.id.startsWith("roads_labels") &&
                !layer.id.startsWith("address") &&
                ![
                    "roads_shields",
                    "roads_oneway",
                    "places_subplace",
                    "earth_label_islands",
                    "boundaries",
                ].includes(layer.id) &&
                // Protomaps' own railway: ours replaces it
                !layer.id.includes("rail"),
        ),
    };
}

export function basemapStyle(
    basemap: Basemap,
    scheme: ColorScheme,
    locale: string,
): string | StyleSpecification {
    switch (basemap) {
        case "current":
            return STYLE_URLS[scheme];
        case "quiet":
            return ofmStyle(QUIET[scheme], locale, false);
        case "transit":
            return ofmStyle(TRANSIT[scheme], locale, true);
        case "protomaps":
            return protomapsStyle(QUIET[scheme], scheme, locale);
    }
}

function slotLayer(id: string): LayerSpecification {
    return { id, type: "background", layout: { visibility: "none" } };
}

/**
 * The production transform for the current basemap; for ours the same
 * contract (base layers marked, slots added, app layers carried over on a
 * switch) without the OpenFreeMap-specific patches.
 */
export function labTransform(
    basemap: Basemap,
    scheme: ColorScheme,
    locale: string,
) {
    if (basemap === "current") return basemapTransform(scheme, locale);
    return (
        previous: StyleSpecification | undefined,
        next: StyleSpecification,
    ): StyleSpecification => {
        const base = next.layers.map(
            (l) =>
                ({
                    ...l,
                    metadata: {
                        ...(l.metadata as object | undefined),
                        [BASE_KEY]: true,
                    },
                }) as LayerSpecification,
        );
        let names = base.findIndex((l) => l.type === "symbol");
        if (names === -1) names = base.length;
        const below = base.slice(0, names);
        const above = base.slice(names);
        const top = Object.values(SLOTS)
            .filter((id) => id !== SLOTS.railway)
            .map(slotLayer);
        if (!previous) {
            return {
                ...next,
                layers: [...below, slotLayer(SLOTS.railway), ...above, ...top],
            };
        }
        const isBase = (l: LayerSpecification) =>
            !!(l.metadata as Record<string, unknown> | undefined)?.[BASE_KEY];
        const app = previous.layers.filter((l) => !isBase(l));
        const split = app.findIndex((l) => l.id === SLOTS.railway) + 1;
        const under =
            split > 0 ? app.slice(0, split) : [slotLayer(SLOTS.railway)];
        const over = split > 0 ? app.slice(split) : app;
        const appSources: Record<string, SourceSpecification> = {};
        for (const [id, source] of Object.entries(previous.sources)) {
            if (!(id in next.sources)) appSources[id] = source;
        }
        const hasSlots = over.some((l) => l.id === SLOTS.route);
        return {
            ...next,
            sources: { ...next.sources, ...appSources },
            layers: [
                ...below,
                ...under,
                ...above,
                ...(hasSlots ? [] : top),
                ...over,
            ],
        };
    };
}
