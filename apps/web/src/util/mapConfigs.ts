/**
 * Base map configurations
 */
type BaseMapConfig = {
    name: string;
    url: string;
    attribution: string;
};

export const BASE_MAPS: Record<string, BaseMapConfig> = {
    openstreetmap: {
        name: "OpenStreetMap",
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
    opentopomap: {
        name: "OpenTopoMap",
        url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
        attribution:
            'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
    },
};

/**
 * Overlay map configurations
 */
type OverlayConfig = {
    name: string;
    url: string;
    attribution: string;
};

export const OVERLAYS: Record<string, OverlayConfig> = {
    railway: {
        name: "OpenRailwayMap",
        url: "https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png",
        attribution:
            'Railway data: &copy; <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>',
    },
};

export type BaseMapKey = keyof typeof BASE_MAPS;
export type OverlayKey = keyof typeof OVERLAYS;
