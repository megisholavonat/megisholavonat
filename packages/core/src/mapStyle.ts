// The map's own MapLibre style, shared by the web (MapLibre GL JS) and the
// app (MapLibre Native): a quiet basemap over OpenFreeMap's OpenMapTiles
// vectors, our passenger rail network and our station names. Colours, widths
// and zoom stops come from ./tokens/map. Only expressions both renderers
// support are used (interpolate, step, match, case, coalesce, get, has, zoom,
// geometry-type): no `within`, `distance`, `global-state` or `slice`.

import type {
    ExpressionSpecification,
    FilterSpecification,
    LayerSpecification,
    StyleSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import {
    MAP_FOCUS,
    MAP_LABELS,
    MAP_NETWORK,
    MAP_PALETTE,
    MAP_STATION_MARK,
    MAP_STATIONS,
    MAP_STOPS,
    type MapPalette,
    type StopShape,
    type ZoomStops,
} from "./tokens/map";
import { COLORS, type ColorScheme } from "./tokens/tokens";

export const OFM_TILES = "https://tiles.openfreemap.org/planet";
/** OpenFreeMap's glyphs (Noto Sans), also used by the app's own labels */
export const MAP_GLYPHS =
    "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
export const MAP_FONTS = {
    regular: ["Noto Sans Regular"],
    bold: ["Noto Sans Bold"],
    italic: ["Noto Sans Italic"],
} as const;

/** The vector source of the basemap */
export const BASEMAP_SOURCE = "openmaptiles";
/** GeoJSON sources the app adds for the network and the stations */
export const NETWORK_SOURCE = "mhav-network";
export const STATIONS_SOURCE = "mhav-stations";
export const MAP_LAYER_IDS = {
    network: "mhav-network",
    stationDot: (tier: number) => `mhav-station-dot-${tier}`,
    stationLabel: (tier: number) => `mhav-station-label-${tier}`,
    /** HÉV and tram-train stops' shaped marks, over the dots */
    stationShape: "mhav-station-shape",
} as const;

/** Stop shapes drawn as sprites; a circle layer draws the round ones */
export const SPRITE_STOP_SHAPES = [
    "square",
    "tramtrain",
] as const satisfies readonly StopShape[];
export type SpriteStopShape = (typeof SPRITE_STOP_SHAPES)[number];

/**
 * The sprite of a shaped station mark: the web draws it on demand, the app
 * ships it as a PNG (scripts/map-sprites.mjs)
 */
export function stopImageId(scheme: ColorScheme, shape: SpriteStopShape) {
    return `mhav-${scheme}-stop-${shape}`;
}

/** API paths of the daily network and station files */
export const MAP_DATA_PATHS = {
    network: "/v1/map/network",
    stations: "/v1/map/stations",
} as const;

type Expr = ExpressionSpecification;

function zoom(stops: ZoomStops): Expr {
    return [
        "interpolate",
        ["linear"],
        ["zoom"],
        ...stops.flat(),
    ] as unknown as Expr;
}

function localName(locale: string): Expr {
    return locale === "en"
        ? ["coalesce", ["get", "name_en"], ["get", "name"]]
        : ["coalesce", ["get", `name:${locale}`], ["get", "name"]];
}

function classIn(classes: string[]): Expr {
    return ["match", ["get", "class"], classes, true, false];
}

function roads(classes: string[]): FilterSpecification {
    return ["all", classIn(classes), ["!=", ["get", "brunnel"], "tunnel"]];
}

const ROUND = { "line-cap": "round", "line-join": "round" } as const;

/**
 * The basemap: land, water, quiet roads, borders, track and place names. No
 * POIs, shields, road names or house numbers: a train map. Place names are
 * the only symbols, so the app's railway slot can go right before them.
 */
export function basemapStyle(
    scheme: ColorScheme,
    locale: string,
): StyleSpecification {
    const p: MapPalette = MAP_PALETTE[scheme];
    const src = BASEMAP_SOURCE;
    const name = localName(locale);
    const layers: LayerSpecification[] = [
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
            filter: classIn([
                "residential",
                "suburb",
                "neighbourhood",
                "commercial",
                "industrial",
                "retail",
            ]),
            paint: {
                "fill-color": p.urban,
                "fill-opacity": zoom([
                    [5, 0.6],
                    [9, 1],
                ]),
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
                "fill-opacity": zoom([
                    [9, 0],
                    [10, 0.8],
                ]),
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
                "line-width": zoom([
                    [6, 0.6],
                    [10, 1.4],
                    [14, 3],
                ]),
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
            paint: { "fill-color": p.roadCasing, "fill-opacity": 0.35 },
        },
        // Roads: casing only where they are wide enough to need it
        {
            id: "road-minor",
            type: "line",
            source: src,
            "source-layer": "transportation",
            minzoom: 13,
            filter: roads(["minor", "tertiary", "service"]),
            layout: ROUND,
            paint: {
                "line-color": p.road,
                "line-width": zoom([
                    [12, 0.5],
                    [14, 2],
                    [16, 6],
                ]),
            },
        },
        {
            id: "road-major-casing",
            type: "line",
            source: src,
            "source-layer": "transportation",
            minzoom: 11,
            filter: roads(["primary", "secondary", "trunk"]),
            layout: ROUND,
            paint: {
                "line-color": p.roadCasing,
                "line-width": zoom([
                    [11, 1.5],
                    [14, 5],
                    [16, 11],
                ]),
            },
        },
        {
            id: "road-major",
            type: "line",
            source: src,
            "source-layer": "transportation",
            minzoom: 8,
            filter: roads(["primary", "trunk"]),
            layout: ROUND,
            paint: {
                "line-color": p.road,
                "line-width": zoom([
                    [7, 0.4],
                    [11, 1],
                    [14, 3.5],
                    [16, 9],
                ]),
            },
        },
        {
            id: "motorway-casing",
            type: "line",
            source: src,
            "source-layer": "transportation",
            minzoom: 6,
            filter: roads(["motorway"]),
            layout: ROUND,
            paint: {
                "line-color": p.motorwayCasing,
                "line-width": zoom([
                    [6, 1],
                    [10, 2.5],
                    [14, 6],
                    [16, 13],
                ]),
            },
        },
        {
            id: "motorway",
            type: "line",
            source: src,
            "source-layer": "transportation",
            minzoom: 9,
            filter: roads(["motorway"]),
            layout: ROUND,
            paint: {
                "line-color": p.motorway,
                "line-width": zoom([
                    [9, 0.6],
                    [10, 1.4],
                    [14, 4],
                    [16, 10],
                ]),
            },
        },
        // Physical track, a hairline under our network: lines without
        // passenger service, and the network's exact course close in
        {
            id: "track",
            type: "line",
            source: src,
            "source-layer": "transportation",
            minzoom: MAP_NETWORK.track.minZoom,
            filter: [
                "all",
                ["==", ["get", "class"], "rail"],
                [
                    "match",
                    ["get", "subclass"],
                    ["rail", "narrow_gauge"],
                    true,
                    false,
                ],
                ["!", ["has", "service"]],
            ],
            layout: { "line-join": "round" },
            paint: {
                "line-color": p.track,
                "line-width": zoom(MAP_NETWORK.track.width),
            },
        },
        {
            id: "track-hev",
            type: "line",
            source: src,
            "source-layer": "transportation",
            minzoom: MAP_NETWORK.hevTrackMinZoom,
            filter: [
                "all",
                ["==", ["get", "class"], "transit"],
                ["==", ["get", "subclass"], "light_rail"],
                ["!", ["has", "service"]],
            ],
            paint: { "line-color": p.railMinor, "line-width": 1 },
        },
        // Borders over roads and water: a soft halo, then a dashed line
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
                "line-width": zoom([
                    [4, 3],
                    [8, 5],
                    [12, 8],
                ]),
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
                "line-width": zoom([
                    [4, 1],
                    [8, 1.5],
                    [12, 2],
                ]),
                "line-dasharray": [4, 1.5],
            },
        },
        // Names: places from small to large (larger wins), water last. No
        // quarters, neighbourhoods or hamlets: our station names say more
        {
            id: "place-village",
            type: "symbol",
            source: src,
            "source-layer": "place",
            minzoom: MAP_LABELS.village.minZoom,
            filter: ["==", ["get", "class"], "village"],
            layout: {
                "text-field": name,
                "text-font": [...MAP_FONTS.regular],
                "text-size": zoom([
                    [10, 11],
                    [14, 13],
                ]),
                "text-max-width": 8,
            },
            paint: {
                "text-color": p.village,
                "text-halo-color": p.halo,
                "text-halo-width": 1.5,
            },
        },
        {
            id: "place-suburb",
            type: "symbol",
            source: src,
            "source-layer": "place",
            minzoom: MAP_LABELS.suburb.minZoom,
            filter: ["==", ["get", "class"], "suburb"],
            layout: {
                "text-field": name,
                "text-font": [...MAP_FONTS.regular],
                "text-size": zoom([
                    [10, 11],
                    [14, 13],
                ]),
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
            minzoom: MAP_LABELS.town.minZoom,
            filter: ["==", ["get", "class"], "town"],
            layout: {
                "text-field": name,
                "text-font": [...MAP_FONTS.regular],
                "text-size": zoom([
                    [8, 11],
                    [12, 14],
                ]),
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
            minzoom: MAP_LABELS.city.minZoom,
            maxzoom: MAP_LABELS.city.maxZoom,
            filter: ["==", ["get", "class"], "city"],
            layout: {
                "text-field": name,
                "text-font": [...MAP_FONTS.bold],
                "text-size": zoom([
                    [5, 11],
                    [8, 13],
                    [12, 17],
                ]),
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
            maxzoom: MAP_LABELS.country.maxZoom,
            filter: ["==", ["get", "class"], "country"],
            layout: {
                "text-field": name,
                "text-font": [...MAP_FONTS.regular],
                "text-size": zoom([
                    [4, 11],
                    [8, 14],
                ]),
                "text-transform": "uppercase",
                "text-letter-spacing": 0.15,
            },
            paint: {
                "text-color": p.country,
                "text-halo-color": p.halo,
                "text-halo-width": 1.5,
            },
        },
        {
            id: "water-name",
            type: "symbol",
            source: src,
            "source-layer": "water_name",
            minzoom: MAP_LABELS.water.minZoom,
            filter: ["==", ["geometry-type"], "Point"],
            layout: {
                "text-field": name,
                "text-font": [...MAP_FONTS.italic],
                "text-size": 12,
            },
            paint: {
                "text-color": p.waterLabel,
                "text-halo-color": p.water,
                "text-halo-width": 1,
            },
        },
    ];
    return {
        version: 8,
        name: `MHaV ${scheme}`,
        glyphs: MAP_GLYPHS,
        sources: {
            [src]: { type: "vector", url: OFM_TILES },
        },
        layers,
    };
}

export interface RailLayerOptions {
    scheme: ColorScheme;
    /** A train is selected in focus mode: the network steps back */
    dim: boolean;
    /** Fade length (ms) of the focus change; 0 with reduced motion */
    fadeMs?: number;
    /** Station names' opacity (a user setting) */
    labelOpacity?: number;
    /**
     * A station whose name the map already shows elsewhere (the selected
     * station's box): its plain name is left out, so it is never named twice
     */
    namedElsewhere?: string | null;
    /**
     * Names end at this zoom: from it the railway overlay writes its own
     * station names, so ours would double them
     */
    labelMaxZoom?: number;
}

function transition(fadeMs: number) {
    return { duration: fadeMs, delay: 0 };
}

/** Trains a day → line class, by MAP_NETWORK's thresholds; HÉV is quiet */
function byLineClass(
    busy: Expr | number | string,
    regular: Expr | number | string,
    quiet: Expr | number | string,
): Expr {
    return [
        "case",
        ["==", ["get", "hev"], 1],
        quiet,
        [">=", ["get", "n"], MAP_NETWORK.busy],
        busy,
        [">=", ["get", "n"], MAP_NETWORK.regular],
        regular,
        quiet,
    ] as Expr;
}

function networkWidth(): Expr {
    const { busy, regular, quiet } = MAP_NETWORK.width;
    const stops = busy.map(([z], i) => [
        z,
        byLineClass(
            busy[i]?.[1] ?? 0,
            regular[i]?.[1] ?? 0,
            quiet[i]?.[1] ?? 0,
        ),
    ]);
    return ["interpolate", ["linear"], ["zoom"], ...stops.flat()] as Expr;
}

/** Our passenger network: width and tone by trains a day. */
export function networkLayer({
    scheme,
    dim,
    fadeMs = MAP_FOCUS.fadeMs,
}: RailLayerOptions): LayerSpecification {
    const p = MAP_PALETTE[scheme];
    const opacity = dim ? MAP_FOCUS.networkOpacity : 1;
    return {
        id: MAP_LAYER_IDS.network,
        type: "line",
        source: NETWORK_SOURCE,
        layout: {
            "line-join": "round",
            "line-cap": "round",
            "line-sort-key": ["get", "n"],
        },
        paint: {
            "line-color": byLineClass(p.rail, p.rail, p.railMinor),
            "line-width": networkWidth(),
            "line-opacity": opacity,
            "line-opacity-transition": transition(fadeMs),
        },
    };
}

/**
 * A station's kind (rail, hev, tramtrain, childrens_railway). Files built
 * before `type` existed only flag HÉV stops (`hev`).
 */
export const STATION_TYPE: Expr = [
    "coalesce",
    ["get", "type"],
    ["match", ["get", "hev"], 1, "hev", "rail"],
];

/** Kinds of stop drawn with a sprite, and the sprite's shape */
const SPRITE_STOP_TYPES = Object.entries(MAP_STOPS.shape).filter(
    ([, shape]) => shape !== "circle",
) as [string, SpriteStopShape][];

/**
 * A station's tier (MAP_STATIONS.tiers) from its trains a day. Stops that
 * are not railway stations (HÉV, tram-train, Children's Railway) see many
 * trains but are city stops: they show at city zoom only.
 */
export const STATION_TIER: Expr = [
    "match",
    STATION_TYPE,
    "rail",
    [
        "step",
        ["get", "perDay"],
        4,
        MAP_STATIONS.tiers[2].min,
        3,
        MAP_STATIONS.tiers[1].min,
        2,
        MAP_STATIONS.tiers[0].min,
        1,
    ],
    5,
];

/** A station dot's radius by zoom, by tier */
function dotRadius(tier: number): ZoomStops {
    const { dot } = MAP_STATIONS;
    return tier === 1 ? dot.top : tier <= 2 ? dot.major : dot.minor;
}

/**
 * Station marks and names by tier: the busiest from country zoom, the rest
 * closer in. Railway stations are dots; HÉV and tram-train stops are drawn
 * in their vehicles' shape (MAP_STOPS), over the dots. Names lose
 * "Budapest-" from city zoom and hide in focus mode (the route's stops name
 * themselves).
 */
export function stationLayers({
    scheme,
    dim,
    fadeMs = MAP_FOCUS.fadeMs,
    labelOpacity = 1,
    namedElsewhere = null,
    labelMaxZoom,
}: RailLayerOptions): {
    dots: LayerSpecification[];
    labels: LayerSpecification[];
} {
    const p = MAP_PALETTE[scheme];
    const opacity = dim ? MAP_FOCUS.networkOpacity : 1;
    const fade = transition(fadeMs);
    const { major, minor } = MAP_STATIONS.labelSize;
    const dots: LayerSpecification[] = [];
    const labels: LayerSpecification[] = [];
    const shaped: Expr = [
        "match",
        STATION_TYPE,
        SPRITE_STOP_TYPES.map(([type]) => type),
        true,
        false,
    ];
    for (const t of MAP_STATIONS.tiers) {
        const big = t.tier <= 2;
        const filter: FilterSpecification = ["==", STATION_TIER, t.tier];
        dots.push({
            id: MAP_LAYER_IDS.stationDot(t.tier),
            type: "circle",
            source: STATIONS_SOURCE,
            minzoom: t.dot,
            filter: ["all", filter, ["!", shaped]],
            paint: {
                "circle-radius": zoom(dotRadius(t.tier)),
                "circle-color": p.stationFill,
                "circle-stroke-color": p.stationStroke,
                "circle-stroke-width": big
                    ? MAP_STATIONS.stroke.major
                    : MAP_STATIONS.stroke.minor,
                "circle-opacity": opacity,
                "circle-stroke-opacity": opacity,
                "circle-opacity-transition": fade,
                "circle-stroke-opacity-transition": fade,
            },
        });
        labels.push({
            id: MAP_LAYER_IDS.stationLabel(t.tier),
            type: "symbol",
            source: STATIONS_SOURCE,
            minzoom: t.label,
            ...(labelMaxZoom === undefined ? {} : { maxzoom: labelMaxZoom }),
            filter: namedElsewhere
                ? ["all", filter, ["!=", ["get", "id"], namedElsewhere]]
                : filter,
            layout: {
                "text-field": [
                    "step",
                    ["zoom"],
                    ["get", "name"],
                    MAP_STATIONS.shortNameZoom,
                    ["get", "short"],
                ],
                "text-font": [...(big ? MAP_FONTS.bold : MAP_FONTS.regular)],
                "text-size": zoom([
                    [7, t.tier === 1 ? major[0] : minor[0]],
                    [12, big ? major[1] : minor[1]],
                ]),
                "text-variable-anchor": ["left", "right", "top", "bottom"],
                "text-radial-offset": 0.6,
                "text-justify": "auto",
                "text-max-width": 9,
                "symbol-sort-key": ["-", 0, ["get", "perDay"]],
            },
            paint: {
                "text-color": p.stationLabel,
                "text-halo-color": p.halo,
                "text-halo-width": MAP_STATIONS.haloWidth,
                "text-opacity": dim ? 0 : labelOpacity,
                "text-opacity-transition": fade,
            },
        });
    }
    // Every shaped stop is a tier 5 city stop: one layer, the tier's size
    const city = MAP_STATIONS.tiers[4];
    dots.push({
        id: MAP_LAYER_IDS.stationShape,
        type: "symbol",
        source: STATIONS_SOURCE,
        minzoom: city.dot,
        filter: shaped as FilterSpecification,
        layout: {
            "icon-image": [
                "match",
                STATION_TYPE,
                ...SPRITE_STOP_TYPES.flatMap(([type, shape]) => [
                    type,
                    stopImageId(scheme, shape),
                ]),
                "",
            ] as unknown as Expr,
            "icon-size": zoom(
                dotRadius(city.tier).map(
                    ([z, r]) =>
                        [z, (r * 2) / MAP_STOPS.spriteDiameter] as const,
                ),
            ),
            // As the dots: drawn always, never in the names' way
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
        },
        paint: {
            "icon-opacity": opacity,
            "icon-opacity-transition": fade,
        },
    });
    return { dots, labels };
}

/**
 * The selected train's route over a land-coloured casing, and its stops
 * (`passed` ones filled grey) with their names, on the web and in the app.
 * Each renderer adds its own ids, sources and order.
 */
export function routePaint(scheme: ColorScheme) {
    const colors = COLORS[scheme];
    const land = MAP_PALETTE[scheme].land;
    const { route } = MAP_FOCUS;
    const layout = { "line-cap": "round", "line-join": "round" } as const;
    return {
        casing: {
            layout,
            paint: {
                "line-color": land,
                "line-width": route.casingWidth,
                "line-opacity": route.casingOpacity,
            },
        },
        line: {
            layout,
            paint: {
                "line-color": colors.ink,
                "line-width": route.width,
                "line-opacity": route.opacity,
            },
        },
        stops: {
            paint: {
                "circle-radius": 4.5,
                "circle-color": [
                    "case",
                    ["boolean", ["get", "passed"], false],
                    colors.ink2,
                    colors.surface,
                ] as Expr,
                "circle-stroke-color": colors.ink,
                "circle-stroke-width": 2,
            },
        },
        stopLabels: {
            layout: {
                "text-field": ["get", "name"] as Expr,
                "text-font": [...MAP_FONTS.bold],
                "text-size": MAP_STATION_MARK.label.size,
                // Beside the stop first: clear of a north-south route line
                "text-variable-anchor": ["left", "right", "top", "bottom"] as (
                    | "left"
                    | "right"
                    | "top"
                    | "bottom"
                )[],
                "text-radial-offset": 0.7,
                "text-justify": "auto" as const,
                "text-max-width": 9,
            },
            paint: {
                "text-color": colors.ink,
                "text-halo-color": land,
                "text-halo-width": 2,
            },
        },
    };
}
