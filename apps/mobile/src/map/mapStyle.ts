import type {
    CircleLayerSpecification,
    FilterSpecification,
    LineLayerSpecification,
    LngLatBounds,
    RasterLayerSpecification,
    StyleSpecification,
    SymbolLayerSpecification,
} from "@maplibre/maplibre-react-native";
import { MAP_DATA_PATHS, MAP_FONTS } from "@megisholavonat/core/mapStyle";
import { COLORS, type ColorScheme, MARKER } from "@megisholavonat/core/tokens";
import {
    MAP_FOCUS,
    MAP_MARKS,
    MAP_PALETTE,
    MAP_STATION_MARK,
    markSizeAt,
} from "@megisholavonat/core/tokens/map";
import {
    ARROW,
    arrowId,
    CHIP,
    chipFitPadding,
    followId,
    MARK_SHAPES,
    type MarkShape,
    markBox,
    ringReach,
    SPRITE_SIZE,
    stationId,
} from "./sprites";

// The app's layers over the shared basemap (@megisholavonat/core/mapStyle):
// the train marks, their numbers and chips, and the selected train's route.
// The same rules as the web's map; see sprites.ts for the marks themselves.

export type { ColorScheme };

/** A MapLibre expression, as the style spec types it */
type Expression = Extract<
    NonNullable<
        NonNullable<CircleLayerSpecification["paint"]>["circle-opacity"]
    >,
    unknown[]
>;
const expr = (value: unknown[]) => value as Expression;

/** The daily network and station files of our API */
export function mapDataUrls(apiUrl: string): {
    network: string;
    stations: string;
} {
    const base = apiUrl.replace(/\/$/, "");
    return {
        network: `${base}${MAP_DATA_PATHS.network}`,
        stations: `${base}${MAP_DATA_PATHS.stations}`,
    };
}

/**
 * Where the app's layers go in the basemap: the network right above the
 * last line layer (the border), under every place name; the stations and
 * trains above everything.
 */
export function basemapAnchors(style: StyleSpecification): {
    belowNames: string;
    top: string;
} {
    const layers = style.layers;
    const firstName = layers.findIndex((l) => l.type === "symbol");
    const below = layers[(firstName > 0 ? firstName : layers.length) - 1];
    const top = layers[layers.length - 1];
    if (!below || !top) throw new Error("Empty basemap style");
    return { belowNames: below.id, top: top.id };
}

// --- OpenRailwayMap overlay (opt-in setting) -------------------------------

const DIRECT_RAILWAY_TILES =
    "https://a.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png";

/** OpenRailwayMap raster tiles, through the tile cache when one is set. */
export function railwayTileUrl(tileCacheUrl?: string): string {
    if (!tileCacheUrl) return DIRECT_RAILWAY_TILES;
    return `${tileCacheUrl.replace(/\/$/, "")}/orm/{z}/{x}/{y}.png`;
}

export const RAILWAY_ATTRIBUTION =
    '<a href="https://www.openrailwaymap.org/">© OpenRailwayMap</a>';

export function railwayPaint(
    scheme: ColorScheme,
): RasterLayerSpecification["paint"] {
    return { "raster-opacity": scheme === "dark" ? 0.6 : 0.8 };
}

// --- train marks -----------------------------------------------------------

/** Unselected trains, clustered where they pile up */
export const VEHICLES_SOURCE = "vehicles-source";
/** The selected and followed trains: never clustered */
export const PINNED_SOURCE = "vehicles-pinned-source";
export const ROUTE_SOURCE = "route-source";
export const STOPS_SOURCE = "stops-source";
/** The chosen station's mark */
export const STATION_MARK_SOURCE = "station-mark-source";

/** Bottom to top */
export const TRAIN_LAYER_IDS = {
    text: "train-text",
    marks: "trains",
    ring: "train-selected",
    arrow: "train-arrow",
    badge: "train-followed",
    chip: "train-chip",
} as const;

export const STATION_MARK_LAYER_IDS = {
    clear: "station-mark-clear",
    ring: "station-mark-ring",
} as const;

export const CLUSTER_LAYER_IDS = {
    bubble: "train-cluster",
    count: "train-cluster-count",
} as const;

const NOT_CLUSTER = expr(["!", ["has", "point_count"]]);
const IS_CLUSTER = expr(["has", "point_count"]);

export const ROUTE_LAYER_IDS = {
    casing: "route-casing",
    line: "route",
    stops: "route-stops",
    stopLabels: "route-stop-labels",
} as const;

function byZoom(stops: readonly (readonly [number, unknown])[]): Expression {
    return expr(["interpolate", ["linear"], ["zoom"], ...stops.flat()]);
}

/** Scale of the sprites by zoom: every vehicle the same size */
const ICON_SIZE = byZoom(MAP_MARKS.size.map(([z, d]) => [z, d / SPRITE_SIZE]));

/** Zooms where the marks' size changes, from `from` on */
function sizeZooms(from: number): number[] {
    return [from, ...MAP_MARKS.size.map(([z]) => z).filter((z) => z > from)];
}

/** A value per shape (`get shape`), for offsets that clear the mark */
function perShape(value: (shape: MarkShape) => unknown): Expression {
    const [first, ...rest] = MARK_SHAPES;
    if (!first) throw new Error("No shapes");
    return expr([
        "match",
        ["get", "shape"],
        ...rest.flatMap((shape) => [shape, value(shape)]),
        value(first),
    ]);
}

/** Half a mark's box (its collision box) at `zoom`, sideways (css px) */
function markHalfAt(shape: MarkShape, zoom: number): number {
    return (markBox(shape).w / 2) * (markSizeAt(zoom) / SPRITE_SIZE);
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * "+N" just clear of its own mark: the box's half plus the gap, in ems of
 * the text, per zoom stop.
 */
export const DELAY_TEXT_OFFSET = byZoom(
    sizeZooms(MAP_MARKS.delayTextMinZoom).map((z) => [
        z,
        perShape((shape) =>
            round3(
                (markHalfAt(shape, z) + MAP_MARKS.delayTextGap) /
                    MAP_MARKS.delayTextSize,
            ),
        ),
    ]),
);

/**
 * The chip's text ends this far left of the mark's centre (ems): clear of
 * the widest selection ring, plus a gap and the box's inset
 */
function chipOffset(zoom: number): Expression {
    const scale = markSizeAt(zoom) / SPRITE_SIZE;
    const ring = Math.max(...MARK_SHAPES.map(ringReach));
    const px = ring * scale + CHIP.gap + CHIP.inset[1];
    return expr(["literal", [-round3(px / CHIP.fontSize), 0]]);
}

/**
 * Stepped by the marks' size stops, each step at its largest size, so the
 * chip clears the widest mark at every zoom
 */
const CHIP_OFFSET = (() => {
    const zooms = MAP_MARKS.size.map(([z]) => z);
    const steps: unknown[] = ["step", ["zoom"], chipOffset(zooms[1] ?? 0)];
    for (let i = 1; i < zooms.length; i++) {
        const z = zooms[i] ?? 0;
        steps.push(z, chipOffset(zooms[i + 1] ?? z));
    }
    return expr(steps);
})();

/** Others fade while a train is selected; followed trains never do. */
export function focusOpacity(selectedId: string | null): Expression | number {
    return selectedId
        ? expr([
              "case",
              [
                  "any",
                  ["==", ["get", "vehicleId"], selectedId],
                  ["get", "followed"],
              ],
              1,
              MAP_FOCUS.othersOpacity,
          ])
        : 1;
}

function isSelected(selectedId: string | null): Expression {
    return expr(["==", ["get", "vehicleId"], selectedId ?? ""]);
}

/** A value per zoom step of the marks' size, each at the step's largest size */
function bySizeStep(value: (zoom: number) => unknown): Expression {
    const zooms = MAP_MARKS.size.map(([z]) => z);
    const steps: unknown[] = ["step", ["zoom"], value(zooms[1] ?? 0)];
    for (let i = 1; i < zooms.length; i++) {
        const z = zooms[i] ?? 0;
        steps.push(z, value(zooms[i + 1] ?? z));
    }
    return expr(steps);
}

/** From the mark's centre to the direction arrow's centre (css px) */
export function arrowDistance(shape: MarkShape, zoom: number): number {
    const scale = markSizeAt(zoom) / SPRITE_SIZE;
    // Its back `gap` px clear of the selection ring around the shape
    return round3(ringReach(shape) * scale + ARROW.gap + ARROW.height / 2);
}

/**
 * The direction arrow straight ahead of the mark: icon-rotate turns the
 * offset with the heading
 */
const ARROW_OFFSET = bySizeStep((zoom) =>
    perShape((shape) => expr(["literal", [0, -arrowDistance(shape, zoom)]])),
);

/** Below this zoom the follow star is drawn smaller, on the small marks */
const FOLLOW_FULL_ZOOM = MARKER.labelMinZoom;
const FOLLOW_SMALL = 0.75;
const FOLLOW_SIZE = expr(["step", ["zoom"], FOLLOW_SMALL, FOLLOW_FULL_ZOOM, 1]);

/** The star on the mark's upper right edge, as on the web (css px) */
function followOffset(zoom: number, size: number): Expression {
    const r = markSizeAt(zoom) / 2;
    // icon-offset is scaled by icon-size
    return expr(["literal", [round3((r + 2) / size), round3(-r / size)]]);
}

const FOLLOW_OFFSET = (() => {
    const zooms = MAP_MARKS.size
        .map(([z]) => z)
        .filter((z) => z > FOLLOW_FULL_ZOOM);
    const steps: unknown[] = [
        "step",
        ["zoom"],
        followOffset(FOLLOW_FULL_ZOOM, FOLLOW_SMALL),
        FOLLOW_FULL_ZOOM,
        followOffset(zooms[0] ?? FOLLOW_FULL_ZOOM, 1),
    ];
    for (let i = 0; i < zooms.length; i++) {
        const z = zooms[i] ?? 0;
        steps.push(z, followOffset(zooms[i + 1] ?? z, 1));
    }
    return expr(steps);
})();

/**
 * The trains, bottom to top: "+N" of unselected late trains (from city
 * zoom), the marks, the selection ring, the followed badge and the chips of
 * the selected and followed trains.
 *
 * The marks take part in placement from city zoom (icon-ignore-placement
 * false) and draw above the "+N" layer, so MapLibre places them first and a
 * number never lands on any mark: it tries each side and hides when none is
 * free, biggest delays first.
 */
export function trainLayers({
    scheme,
    selectedId,
    source = VEHICLES_SOURCE,
    suffix = "",
    dimmed,
    fadeMs = MAP_FOCUS.fadeMs,
}: {
    scheme: ColorScheme;
    selectedId: string | null;
    /** The source the layers read; VEHICLES_SOURCE is clustered */
    source?: string;
    /** Appended to the layer ids, one set per source */
    suffix?: string;
    /**
     * Every train of the source steps back (another one is open). A
     * constant, so MapLibre fades it over `fadeMs`; by default the trains
     * fade by feature (focusOpacity), without a transition
     */
    dimmed?: boolean;
    fadeMs?: number;
}): {
    text: SymbolLayerSpecification;
    marks: SymbolLayerSpecification;
    ring: SymbolLayerSpecification;
    arrow: SymbolLayerSpecification;
    badge: SymbolLayerSpecification;
    chip: SymbolLayerSpecification;
} {
    const opacity =
        dimmed === undefined
            ? focusOpacity(selectedId)
            : dimmed
              ? MAP_FOCUS.othersOpacity
              : 1;
    const fade = { duration: fadeMs, delay: 0 };
    return {
        text: {
            id: TRAIN_LAYER_IDS.text + suffix,
            type: "symbol",
            source,
            minzoom: MAP_MARKS.delayTextMinZoom,
            filter: [
                "all",
                NOT_CLUSTER,
                ["!=", ["get", "text"], ""],
                ["!", ["get", "followed"]],
                ["!", isSelected(selectedId)],
            ] as FilterSpecification,
            layout: {
                "text-field": ["get", "text"],
                "text-font": [...MAP_FONTS.bold],
                "text-size": MAP_MARKS.delayTextSize,
                // Right of the mark first, as on the web
                "text-variable-anchor": ["left", "right", "bottom", "top"],
                "text-radial-offset": DELAY_TEXT_OFFSET,
                "text-justify": "auto",
                "text-padding": 0,
                "symbol-sort-key": ["-", 0, ["get", "delay"]],
            },
            paint: {
                "text-color": ["get", "textColor"],
                "text-halo-color": MAP_PALETTE[scheme].land,
                "text-halo-width": 1,
                "text-opacity": opacity,
                "text-opacity-transition": fade,
            },
        },
        marks: {
            id: TRAIN_LAYER_IDS.marks + suffix,
            type: "symbol",
            source,
            filter: NOT_CLUSTER as FilterSpecification,
            layout: {
                "icon-image": ["get", "icon"],
                "icon-size": ICON_SIZE,
                "icon-allow-overlap": true,
                // Out at country zoom the marks just stack
                "icon-ignore-placement": [
                    "step",
                    ["zoom"],
                    true,
                    MAP_MARKS.delayTextMinZoom,
                    false,
                ],
                "icon-padding": 0,
                "symbol-sort-key": [
                    "case",
                    isSelected(selectedId),
                    100,
                    ["get", "sort"],
                ],
            },
            paint: { "icon-opacity": opacity, "icon-opacity-transition": fade },
        },
        ring: {
            id: TRAIN_LAYER_IDS.ring + suffix,
            type: "symbol",
            source,
            filter: isSelected(selectedId) as FilterSpecification,
            layout: {
                "icon-image": ["get", "ring"],
                "icon-size": ICON_SIZE,
                "icon-allow-overlap": true,
                // Always drawn, and names below keep clear of it
                "icon-ignore-placement": false,
            },
        },
        // Direction of travel, as on the web: from the zoom the web's
        // markers get their labels, not for old data or a standing train
        arrow: {
            id: TRAIN_LAYER_IDS.arrow + suffix,
            type: "symbol",
            source,
            minzoom: ARROW.minZoom,
            filter: [
                "all",
                isSelected(selectedId),
                ["==", ["get", "moving"], true],
            ] as FilterSpecification,
            layout: {
                "icon-image": arrowId(scheme),
                "icon-rotate": ["get", "heading"],
                "icon-rotation-alignment": "map",
                "icon-offset": ARROW_OFFSET,
                "icon-allow-overlap": true,
                "icon-ignore-placement": true,
            },
        },
        // The web's star on the mark's upper right edge
        badge: {
            id: TRAIN_LAYER_IDS.badge + suffix,
            type: "symbol",
            source,
            filter: ["==", ["get", "followed"], true],
            layout: {
                "icon-image": followId(scheme),
                "icon-size": FOLLOW_SIZE,
                "icon-offset": FOLLOW_OFFSET,
                "icon-allow-overlap": true,
                "icon-ignore-placement": true,
            },
        },
        chip: {
            id: TRAIN_LAYER_IDS.chip + suffix,
            type: "symbol",
            source,
            filter: [
                "all",
                ["!=", ["get", "label"], ""],
                ["any", ["get", "followed"], isSelected(selectedId)],
            ] as FilterSpecification,
            layout: {
                "text-field": ["get", "label"],
                "text-font": [...MAP_FONTS.bold],
                "text-size": CHIP.fontSize,
                "text-anchor": "right",
                "text-offset": CHIP_OFFSET,
                "text-allow-overlap": true,
                "text-ignore-placement": false,
                "icon-image": ["get", "chip"],
                "icon-text-fit": "both",
                "icon-text-fit-padding": chipFitPadding(),
                "icon-allow-overlap": true,
                "icon-ignore-placement": false,
                "symbol-sort-key": ["get", "sort"],
            },
            paint: { "text-color": ["get", "labelColor"] },
        },
    };
}

/**
 * Trains that truly pile up (a terminus, a busy junction): a neutral bubble
 * with their count, as on the web. Two passing trains stay two marks
 * (MAP_MARKS.clusterRadius / clusterMinPoints).
 */
export function clusterLayers({
    scheme,
    selectedId,
    fadeMs = MAP_FOCUS.fadeMs,
}: {
    scheme: ColorScheme;
    selectedId: string | null;
    fadeMs?: number;
}): { bubble: CircleLayerSpecification; count: SymbolLayerSpecification } {
    const colors = COLORS[scheme];
    const opacity = selectedId ? MAP_FOCUS.othersOpacity : 1;
    const fade = { duration: fadeMs, delay: 0 };
    return {
        bubble: {
            id: CLUSTER_LAYER_IDS.bubble,
            type: "circle",
            source: VEHICLES_SOURCE,
            filter: IS_CLUSTER as FilterSpecification,
            paint: {
                // 20 / 24 / 30 px across, as the web's bubbles
                "circle-radius": [
                    "step",
                    ["get", "point_count"],
                    10,
                    10,
                    12,
                    50,
                    15,
                ],
                "circle-color": colors.surface,
                "circle-stroke-color": colors.ink2,
                "circle-stroke-width": MARKER.outlineWidth,
                "circle-opacity": opacity,
                "circle-stroke-opacity": opacity,
                "circle-opacity-transition": fade,
                "circle-stroke-opacity-transition": fade,
            },
        },
        count: {
            id: CLUSTER_LAYER_IDS.count,
            type: "symbol",
            source: VEHICLES_SOURCE,
            filter: IS_CLUSTER as FilterSpecification,
            layout: {
                "text-field": ["get", "point_count_abbreviated"],
                "text-font": [...MAP_FONTS.bold],
                "text-size": 12,
                "text-allow-overlap": true,
                // From city zoom "+N" keeps clear of it too
                "text-ignore-placement": [
                    "step",
                    ["zoom"],
                    true,
                    MAP_MARKS.delayTextMinZoom,
                    false,
                ],
            },
            paint: {
                "text-color": colors.ink,
                "text-opacity": opacity,
                "text-opacity-transition": fade,
            },
        },
    };
}

// --- the selected train's route --------------------------------------------

/**
 * From this zoom the railway overlay (a raster, its z11 tiles picked from
 * 10.5 on) writes out station names: with it on, a route's stop names show
 * below it only, so a station is never named twice in one spot (as on the
 * web)
 */
export const RAILWAY_NAMES_MIN_ZOOM = 10.5;

/**
 * The selected train's route over a land-coloured casing, and its stops
 * (passed ones filled grey) with their names, sized as on the web. The
 * names follow the station names setting.
 */
export function routeLayers(
    scheme: ColorScheme,
    {
        names = true,
        namesOpacity = 1,
        railwayOverlay = false,
    }: {
        names?: boolean;
        namesOpacity?: number;
        railwayOverlay?: boolean;
    } = {},
): {
    casing: LineLayerSpecification;
    line: LineLayerSpecification;
    stops: CircleLayerSpecification;
    stopLabels: SymbolLayerSpecification;
} {
    const colors = COLORS[scheme];
    const land = MAP_PALETTE[scheme].land;
    const { route } = MAP_FOCUS;
    const round = { "line-cap": "round", "line-join": "round" } as const;
    return {
        casing: {
            id: ROUTE_LAYER_IDS.casing,
            type: "line",
            source: ROUTE_SOURCE,
            layout: round,
            paint: {
                "line-color": land,
                "line-width": route.casingWidth,
                "line-opacity": route.casingOpacity,
            },
        },
        line: {
            id: ROUTE_LAYER_IDS.line,
            type: "line",
            source: ROUTE_SOURCE,
            layout: round,
            paint: {
                "line-color": colors.ink,
                "line-width": route.width,
                "line-opacity": route.opacity,
            },
        },
        stops: {
            id: ROUTE_LAYER_IDS.stops,
            type: "circle",
            source: STOPS_SOURCE,
            paint: {
                "circle-radius": 4.5,
                "circle-color": [
                    "case",
                    ["get", "passed"],
                    colors.ink2,
                    colors.surface,
                ],
                "circle-stroke-color": colors.ink,
                "circle-stroke-width": 2,
            },
        },
        stopLabels: {
            id: ROUTE_LAYER_IDS.stopLabels,
            type: "symbol",
            source: STOPS_SOURCE,
            ...(railwayOverlay ? { maxzoom: RAILWAY_NAMES_MIN_ZOOM } : {}),
            layout: {
                // Hidden rather than removed: the layers above name it
                visibility: names ? "visible" : "none",
                "text-field": ["get", "name"],
                "text-font": [...MAP_FONTS.bold],
                "text-size": MAP_STATION_MARK.label.size,
                "text-variable-anchor": ["left", "right", "top", "bottom"],
                "text-radial-offset": 0.7,
                "text-justify": "auto",
                "text-max-width": 9,
            },
            paint: {
                "text-color": colors.ink,
                "text-halo-color": land,
                "text-halo-width": 1.5,
                "text-opacity": namesOpacity,
            },
        },
    };
}

// --- the chosen station ------------------------------------------------------

/**
 * The chosen station, as on the web: under the trains a clearing in the map
 * colour (keeps the ring legible over the railway overlay), and above the
 * bubbles the ring. Its name is a card view over the map (TrainMap).
 */
export function stationMarkLayers(scheme: ColorScheme): {
    clear: SymbolLayerSpecification;
    ring: SymbolLayerSpecification;
} {
    const layout = {
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
    } as const;
    return {
        clear: {
            id: STATION_MARK_LAYER_IDS.clear,
            type: "symbol",
            source: STATION_MARK_SOURCE,
            layout: { ...layout, "icon-image": stationId(scheme, "clear") },
        },
        ring: {
            id: STATION_MARK_LAYER_IDS.ring,
            type: "symbol",
            source: STATION_MARK_SOURCE,
            layout: { ...layout, "icon-image": stationId(scheme, "ring") },
        },
    };
}

/** Hungary, as on the web. */
export const INITIAL_VIEW = {
    center: [19.4, 47.17] as [number, number],
    zoom: 6,
};

/** [west, south, east, north], matching the web's maxBounds. */
export const MAX_BOUNDS: LngLatBounds = [5.5, 43, 30, 52.5];
