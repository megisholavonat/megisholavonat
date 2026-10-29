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
import { COLORS, type ColorScheme } from "@megisholavonat/core/tokens";
import {
    MAP_FOCUS,
    MAP_MARKS,
    MAP_PALETTE,
    markSizeAt,
} from "@megisholavonat/core/tokens/map";
import {
    CHIP,
    chipFitPadding,
    MARK_SHAPES,
    type MarkShape,
    markBox,
    ringReach,
    SPRITE_SIZE,
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

export const VEHICLES_SOURCE = "vehicles-source";
export const ROUTE_SOURCE = "route-source";
export const STOPS_SOURCE = "stops-source";

/** Bottom to top */
export const TRAIN_LAYER_IDS = {
    text: "train-text",
    marks: "trains",
    ring: "train-selected",
    badge: "train-followed",
    chip: "train-chip",
} as const;

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
function perShape(value: (shape: MarkShape) => number): Expression {
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
}: {
    scheme: ColorScheme;
    selectedId: string | null;
}): {
    text: SymbolLayerSpecification;
    marks: SymbolLayerSpecification;
    ring: SymbolLayerSpecification;
    badge: CircleLayerSpecification;
    chip: SymbolLayerSpecification;
} {
    const colors = COLORS[scheme];
    const opacity = focusOpacity(selectedId);
    const source = VEHICLES_SOURCE;
    return {
        text: {
            id: TRAIN_LAYER_IDS.text,
            type: "symbol",
            source,
            minzoom: MAP_MARKS.delayTextMinZoom,
            filter: [
                "all",
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
            },
        },
        marks: {
            id: TRAIN_LAYER_IDS.marks,
            type: "symbol",
            source,
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
            paint: { "icon-opacity": opacity },
        },
        ring: {
            id: TRAIN_LAYER_IDS.ring,
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
        badge: {
            id: TRAIN_LAYER_IDS.badge,
            type: "circle",
            source,
            filter: ["==", ["get", "followed"], true],
            paint: {
                "circle-radius": 3.5,
                "circle-color": colors.ink,
                "circle-stroke-color": colors.surface,
                "circle-stroke-width": 1.5,
                // On the mark's upper right, as it grows with zoom
                "circle-translate": [
                    "step",
                    ["zoom"],
                    ["literal", [5, -5]],
                    10,
                    ["literal", [5.5, -5.5]],
                    13,
                    ["literal", [6.5, -6.5]],
                ],
            } as CircleLayerSpecification["paint"],
        },
        chip: {
            id: TRAIN_LAYER_IDS.chip,
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

// --- the selected train's route --------------------------------------------

/**
 * The selected train's route over a land-coloured casing, and its stops
 * (passed ones filled) with their names.
 */
export function routeLayers(scheme: ColorScheme): {
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
                "circle-radius": 3.5,
                "circle-color": [
                    "case",
                    ["get", "passed"],
                    colors.ink,
                    colors.surface,
                ],
                "circle-stroke-color": colors.ink,
                "circle-stroke-width": 1.5,
            },
        },
        stopLabels: {
            id: ROUTE_LAYER_IDS.stopLabels,
            type: "symbol",
            source: STOPS_SOURCE,
            layout: {
                "text-field": ["get", "name"],
                "text-font": [...MAP_FONTS.bold],
                "text-size": 12,
                "text-variable-anchor": ["left", "right", "top", "bottom"],
                "text-radial-offset": 0.7,
                "text-justify": "auto",
                "text-max-width": 9,
            },
            paint: {
                "text-color": colors.ink,
                "text-halo-color": land,
                "text-halo-width": 1.5,
            },
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
