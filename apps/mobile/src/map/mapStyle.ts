import type {
    CircleLayerSpecification,
    LngLatBounds,
    RasterLayerSpecification,
    SymbolLayerSpecification,
} from "@maplibre/maplibre-react-native";
import { MARKER } from "@megisholavonat/core/tokens";

// Base map and railway overlay kept in sync with
// apps/web/src/app/[locale]/MapComponent.tsx and apps/web/src/util/mapConfigs.ts
// so both clients render the same map.

export type ColorScheme = "light" | "dark";

const BASE_STYLES: Record<ColorScheme, string> = {
    light: "https://tiles.openfreemap.org/styles/liberty",
    dark: "https://tiles.openfreemap.org/styles/dark",
};

export function baseStyleUrl(scheme: ColorScheme): string {
    return BASE_STYLES[scheme];
}

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

// Marker layers read the paint values resolved per feature in markers.ts.

/** Zoom where dots turn into labelled markers. */
export const LABEL_MIN_ZOOM = MARKER.labelMinZoom;

type Expression = CircleLayerSpecification["paint"] extends infer P
    ? P extends { "circle-radius"?: infer R }
        ? R
        : never
    : never;

function radius(extra = 0): Expression {
    return [
        "step",
        ["zoom"],
        ["+", ["get", "dotRadius"], extra],
        LABEL_MIN_ZOOM,
        ["+", ["get", "pillRadius"], extra],
    ] as Expression;
}

/** Others fade while a train is selected; followed trains never do. */
function selectionOpacity(selectedId: string | null): Expression {
    return selectedId
        ? ([
              "case",
              [
                  "any",
                  ["==", ["get", "vehicleId"], selectedId],
                  ["get", "followed"],
              ],
              1,
              MARKER.selected.othersOpacity,
          ] as Expression)
        : 1;
}

export function markerPaint(
    selectedId: string | null,
): CircleLayerSpecification["paint"] {
    const opacity = selectionOpacity(selectedId);
    return {
        "circle-radius": radius(),
        "circle-color": ["get", "fill"],
        "circle-stroke-color": ["get", "stroke"],
        "circle-stroke-width": ["get", "strokeWidth"],
        "circle-opacity": opacity,
        "circle-stroke-opacity": opacity,
    };
}

/** Soft ink halo outside the white ring (light-mode blue and red). */
export function haloPaint(
    selectedId: string | null,
): CircleLayerSpecification["paint"] {
    return {
        // Outline (1.5) + 1 px of halo beyond the fill
        "circle-radius": radius(2.5),
        "circle-color": ["get", "halo"],
        "circle-opacity": selectionOpacity(selectedId),
    };
}

export const HALO_FILTER: CircleLayerSpecification["filter"] = [
    "!=",
    ["get", "halo"],
    "",
];

/** Ink ring around the selected marker, `gap` px off its outline. */
export function selectedRingPaint(
    ink: string,
): CircleLayerSpecification["paint"] {
    const { gap, ringWidth } = MARKER.selected;
    return {
        "circle-radius": radius(MARKER.outlineWidth + gap),
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": ink,
        "circle-stroke-width": ringWidth,
    };
}

export const FOLLOWED_FILTER: CircleLayerSpecification["filter"] = [
    "==",
    ["get", "followed"],
    true,
];

/**
 * Followed trains: a small ink badge on the marker's upper right, always
 * shown (design: "követett: tinta csillag"). A circle, as the map's glyph
 * font has no star.
 */
export function followedBadgePaint(
    ink: string,
    surface: string,
): CircleLayerSpecification["paint"] {
    return {
        "circle-radius": 4.5,
        "circle-color": ink,
        "circle-stroke-color": surface,
        "circle-stroke-width": 1.5,
        "circle-translate": [
            "step",
            ["zoom"],
            ["literal", [5, -5]],
            LABEL_MIN_ZOOM,
            ["literal", [9, -9]],
        ],
    } as CircleLayerSpecification["paint"];
}

export const MARKER_LAYOUT: CircleLayerSpecification["layout"] = {
    "circle-sort-key": ["get", "sort"],
};

export const LABEL_LAYOUT: SymbolLayerSpecification["layout"] = {
    "text-field": ["get", "label"],
    "text-size": ["get", "fontSize"],
    // OpenFreeMap's glyph server has this stack for both styles
    "text-font": ["Noto Sans Bold"],
    "text-allow-overlap": true,
    "text-ignore-placement": true,
    "symbol-sort-key": ["get", "sort"],
};

export function labelPaint(
    selectedId: string | null,
): SymbolLayerSpecification["paint"] {
    return {
        "text-color": ["get", "labelColor"],
        "text-opacity": selectionOpacity(selectedId),
    };
}

/** Hungary, as on the web. */
export const INITIAL_VIEW = {
    center: [19.4, 47.17] as [number, number],
    zoom: 6,
};

/** [west, south, east, north], matching the web's maxBounds. */
export const MAX_BOUNDS: LngLatBounds = [5.5, 43, 30, 52.5];
