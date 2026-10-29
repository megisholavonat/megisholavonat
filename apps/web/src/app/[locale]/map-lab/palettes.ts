import { COLORS, type ColorScheme } from "@megisholavonat/core/tokens";

/**
 * Basemap palettes of the lab's own styles. Land is the token map colour the
 * marker colours were checked against; every other colour is a neutral step
 * off it (no hue but water and a trace of green in parks), so delay stays the
 * only colour on the map. Light values follow the design's map mock
 * (map-light.svg / map-dark.svg); dark ones are pushed for contrast.
 */
export interface Palette {
    land: string;
    urban: string;
    park: string;
    water: string;
    waterLine: string;
    /** Country border and the halo under it */
    border: string;
    borderHalo: string;
    /** County borders */
    region: string;
    road: string;
    roadCasing: string;
    motorway: string;
    motorwayCasing: string;
    /** Place names: capital/city, town, village; and their halo */
    city: string;
    town: string;
    village: string;
    country: string;
    halo: string;
    waterLabel: string;
    /** Our rail network: main lines, branches, track without service */
    rail: string;
    railMinor: string;
    track: string;
    /** Station dots and labels */
    stationFill: string;
    stationStroke: string;
    stationLabel: string;
}

const L = COLORS.light;
const D = COLORS.dark;

export const QUIET: Record<ColorScheme, Palette> = {
    light: {
        land: L.map,
        urban: "#E4E7E1",
        park: "#DFE8D9",
        water: "#B7CEDD",
        waterLine: "#A9C4D6",
        border: "#5E646E",
        borderHalo: "#D9DCD6",
        region: "#B3B8BF",
        road: "#FFFFFF",
        roadCasing: "#DADDE2",
        motorway: "#FFFFFF",
        motorwayCasing: "#CDD1D6",
        city: "#2B2F36",
        town: "#4A4F57",
        village: "#646A73",
        country: "#5E646E",
        halo: L.map,
        waterLabel: "#4F7189",
        rail: "#6E747D",
        railMinor: "#80868F",
        track: "#B3B7BD",
        stationFill: "#FFFFFF",
        stationStroke: "#4A4F57",
        stationLabel: "#2B2F36",
    },
    dark: {
        land: D.map,
        urban: "#20242A",
        park: "#1D2622",
        water: "#1E3A50",
        waterLine: "#28485F",
        border: "#9AA0A9",
        borderHalo: "#2A2E35",
        region: "#4A4F58",
        road: "#272B31",
        roadCasing: "#272B31",
        motorway: "#30353C",
        motorwayCasing: "#30353C",
        city: "#D5D9DE",
        town: "#AEB4BD",
        village: "#8C929C",
        country: "#9AA0A9",
        halo: D.map,
        waterLabel: "#7FA6C2",
        rail: "#7A808A",
        railMinor: "#656B74",
        track: "#3D424A",
        stationFill: D.map,
        stationStroke: "#B4BAC3",
        stationLabel: "#D5D9DE",
    },
};

/**
 * "Transit": roads drop almost out, towns sit back, the rail network and
 * station names lead.
 */
export const TRANSIT: Record<ColorScheme, Palette> = {
    light: {
        ...QUIET.light,
        urban: "#E2E5DF",
        road: "#F7F8F6",
        roadCasing: "#E3E6E1",
        motorway: "#FFFFFF",
        motorwayCasing: "#D9DCD8",
        city: "#3C4149",
        town: "#555B64",
        village: "#646A73",
        rail: "#5E646E",
        railMinor: "#7C828B",
        track: "#C2C6CB",
    },
    dark: {
        ...QUIET.dark,
        urban: "#1F2328",
        road: "#23272D",
        roadCasing: "#23272D",
        motorway: "#292D33",
        motorwayCasing: "#292D33",
        city: "#B4BAC3",
        town: "#A2A8B2",
        village: "#8C929C",
        rail: "#858B94",
        railMinor: "#6A7079",
        track: "#363A41",
    },
};

/**
 * The current basemap's colours (OpenFreeMap Positron / Dark, with our land
 * colour patched in) and the OpenRailwayMap raster's main line, blended the
 * way the app draws it (light: 75 % opacity, saturation −0.4; dark:
 * inverted, 55 %): main lines sampled from screenshots, branches
 * estimated. For the contrast table only.
 */
export const CURRENT: Record<
    ColorScheme,
    Pick<
        Palette,
        "land" | "water" | "border" | "city" | "village" | "rail" | "railMinor"
    >
> = {
    light: {
        land: L.map,
        water: "#C2C8CA",
        border: "#B3B3B3",
        city: "#000000",
        village: "#000000",
        // #FF8100 main / #C4B600 branch, as rendered over our land
        rail: "#D59C61",
        railMinor: "#D4CD6E",
    },
    dark: {
        land: D.map,
        water: "#1B1B1D",
        border: "#3B3B3B",
        city: "#656565",
        village: "#656565",
        rail: "#403D3A",
        railMinor: "#363431",
    },
};
