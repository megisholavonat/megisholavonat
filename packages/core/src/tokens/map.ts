// Map style tokens: the basemap palette, the rail network's widths, the
// station tiers and the train marks, for the web (MapLibre GL) and the app
// (MapLibre Native). The style itself is built from these in ../mapStyle.
//
// Rules (map lab, "B · Transit"): only trains carry hue; the network is one
// neutral grey ranked by width, ≥ 3:1 on land; borders and water read in both
// themes; detail comes in with zoom; dark is tuned on its own, not inverted.

import { COLORS, type ColorScheme } from "./tokens";

export interface MapPalette {
    /** The land colour the marker colours were checked against */
    land: string;
    urban: string;
    park: string;
    water: string;
    waterLine: string;
    /** Country border and the soft halo under it */
    border: string;
    borderHalo: string;
    road: string;
    roadCasing: string;
    motorway: string;
    motorwayCasing: string;
    /** Place names: city, town, village, country; and their halo */
    city: string;
    town: string;
    village: string;
    country: string;
    halo: string;
    waterLabel: string;
    /** Our rail network: busy lines, quiet lines, track without service */
    rail: string;
    railMinor: string;
    track: string;
    /** Station dots and names */
    stationFill: string;
    stationStroke: string;
    stationLabel: string;
}

export const MAP_PALETTE = {
    light: {
        land: COLORS.light.map,
        urban: "#E2E5DF",
        park: "#DFE8D9",
        water: "#B7CEDD",
        waterLine: "#A9C4D6",
        border: "#5E646E",
        borderHalo: "#D9DCD6",
        road: "#F7F8F6",
        roadCasing: "#E3E6E1",
        motorway: "#FFFFFF",
        motorwayCasing: "#D9DCD8",
        city: "#3C4149",
        town: "#555B64",
        village: "#646A73",
        country: "#5E646E",
        halo: COLORS.light.map,
        waterLabel: "#4F7189",
        rail: "#5E646E",
        railMinor: "#7C828B",
        track: "#C2C6CB",
        stationFill: "#FFFFFF",
        stationStroke: "#4A4F57",
        stationLabel: "#2B2F36",
    },
    dark: {
        land: COLORS.dark.map,
        urban: "#1F2328",
        park: "#1D2622",
        water: "#1E3A50",
        waterLine: "#28485F",
        border: "#9AA0A9",
        borderHalo: "#2A2E35",
        road: "#23272D",
        roadCasing: "#23272D",
        motorway: "#292D33",
        motorwayCasing: "#292D33",
        city: "#B4BAC3",
        town: "#A2A8B2",
        village: "#8C929C",
        country: "#9AA0A9",
        halo: COLORS.dark.map,
        waterLabel: "#7FA6C2",
        rail: "#858B94",
        railMinor: "#6A7079",
        track: "#363A41",
        stationFill: COLORS.dark.map,
        stationStroke: "#B4BAC3",
        stationLabel: "#D5D9DE",
    },
} as const satisfies Record<ColorScheme, MapPalette>;

/** [zoom, value] pairs for a linear zoom interpolation */
export type ZoomStops = readonly (readonly [number, number])[];

/**
 * Our passenger network, from the timetable's route shapes. `n` is trains a
 * day on a section: busy lines are drawn widest, quiet ones thin and lighter.
 * HÉV always draws as a quiet line.
 */
export const MAP_NETWORK = {
    /** Trains a day from which a section is a busy line */
    busy: 40,
    /** …a regular line; below it a quiet line */
    regular: 12,
    width: {
        busy: [
            [5, 1.6],
            [8, 2.6],
            [12, 3.4],
            [15, 4.5],
        ],
        regular: [
            [5, 1],
            [8, 1.7],
            [12, 2.4],
            [15, 3.2],
        ],
        quiet: [
            [5, 0.6],
            [8, 1.1],
            [12, 1.6],
            [15, 2.2],
        ],
    },
    /** Physical track from the basemap (OpenMapTiles), a hairline */
    track: {
        minZoom: 8,
        width: [
            [8, 0.6],
            [12, 1.2],
            [16, 2],
        ],
    },
    /** HÉV track from the basemap, from city zoom */
    hevTrackMinZoom: 11,
} as const satisfies {
    width: Record<"busy" | "regular" | "quiet", ZoomStops>;
    [key: string]: unknown;
};

export interface StationTier {
    tier: number;
    /** Trains a day from which a station is in this tier */
    min: number;
    /** Zoom from which its dot shows */
    dot: number;
    /** Zoom from which its name shows */
    label: number;
}

/**
 * Station names by trains a day: the busiest from country zoom, the rest as
 * the map comes closer. HÉV and tram-train street stops (tier 5, "Szeged,
 * Anna-kút") only at city zoom.
 */
export const MAP_STATIONS = {
    tiers: [
        { tier: 1, min: 80, dot: 6.5, label: 7 },
        { tier: 2, min: 40, dot: 8, label: 8.5 },
        { tier: 3, min: 15, dot: 9.5, label: 10 },
        { tier: 4, min: 0, dot: 11, label: 11.5 },
        { tier: 5, min: -1, dot: 11.5, label: 12.5 },
    ],
    /** From this zoom Budapest stations drop the city: "Keleti" */
    shortNameZoom: 10,
    labelSize: { major: [12, 14], minor: [11, 12.5] },
    haloWidth: 1.6,
} as const satisfies { tiers: readonly StationTier[]; [key: string]: unknown };

/** A selected train in focus: everything but its route steps back. */
export const MAP_FOCUS = {
    /** Other trains */
    othersOpacity: 0.25,
    /** The network and station dots; station names hide */
    networkOpacity: 0.3,
    route: { width: 5, opacity: 0.9, casingWidth: 9, casingOpacity: 0.9 },
    fadeMs: 200,
} as const;

/**
 * Train marks on the map: one size for every vehicle at a zoom, colour is
 * the delay band, shape is the vehicle type (round train, square HÉV,
 * pointed tram-train) at the same optical weight.
 */
export const MAP_MARKS = {
    /** Diameter of a train's mark (css px) by zoom */
    size: [
        [6, 12],
        [10, 14],
        [13, 16],
    ],
    /** The sprite's reference size: icon-size is size / this */
    spriteSize: 16,
    /**
     * Shapes at the same area as the circle: a HÉV square's side and a
     * tram-train's width and height, as shares of the diameter
     */
    hevSide: 0.9,
    tramtrain: { width: 1.2, height: 0.84 },
    /** "+N" beside unselected late trains, from this zoom only */
    delayTextMinZoom: 12,
    delayTextSize: 12,
    /** Gap between a mark's edge and its "+N" (px) */
    delayTextGap: 2,
    /**
     * Trains merge into a neutral count bubble only where they truly pile up
     * (a terminus, a busy junction): within this many px, at least
     * clusterMinPoints of them. Two passing trains stay two marks.
     */
    clusterRadius: 8,
    clusterMinPoints: 3,
} as const satisfies { size: ZoomStops; [key: string]: unknown };

/** The mark's diameter at `zoom`, as the map interpolates it. */
export function markSizeAt(zoom: number): number {
    const stops = MAP_MARKS.size;
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (zoom <= first[0]) return first[1];
    if (zoom >= last[0]) return last[1];
    for (let i = 1; i < stops.length; i++) {
        const [z1, v1] = stops[i];
        const [z0, v0] = stops[i - 1];
        if (zoom <= z1) return v0 + ((v1 - v0) * (zoom - z0)) / (z1 - z0);
    }
    return last[1];
}
