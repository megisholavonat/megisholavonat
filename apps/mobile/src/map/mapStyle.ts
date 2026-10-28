import type {
    CircleLayerSpecification,
    LngLatBounds,
    RasterLayerSpecification,
} from "@maplibre/maplibre-react-native";
import {
    ORANGE_THRESHOLD,
    RED_THRESHOLD,
    YELLOW_THRESHOLD,
} from "@megisholavonat/core/constants";
import { DELAY_COLORS, NO_DATA_COLOR } from "@megisholavonat/core/delay";

// Kept in sync with apps/web/src/app/[locale]/MapComponent.tsx and
// apps/web/src/util/mapConfigs.ts so both clients render the same map.

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

export const TRAIN_CIRCLE_PAINT = {
    "circle-radius": 8,
    "circle-color": [
        "case",
        ["==", ["get", "isStale"], true],
        NO_DATA_COLOR,
        [
            "step",
            ["coalesce", ["get", "delay"], 0],
            DELAY_COLORS.onTime,
            YELLOW_THRESHOLD,
            DELAY_COLORS.slight,
            ORANGE_THRESHOLD,
            DELAY_COLORS.moderate,
            RED_THRESHOLD,
            DELAY_COLORS.severe,
        ],
    ],
    "circle-stroke-width": 2.5,
    "circle-stroke-color": [
        "case",
        ["==", ["get", "type"], "tramtrain"],
        "#f9a825",
        ["==", ["get", "type"], "hev"],
        "#009860",
        "#2f4550",
    ],
} satisfies CircleLayerSpecification["paint"];

/** Hungary, as on the web. */
export const INITIAL_VIEW = {
    center: [19.4, 47.17] as [number, number],
    zoom: 6,
};

/** [west, south, east, north], matching the web's maxBounds. */
export const MAX_BOUNDS: LngLatBounds = [5.5, 43, 30, 52.5];
