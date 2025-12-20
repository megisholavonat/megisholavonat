import { env } from "@/env/client";

/**
 * Base map configurations
 */
type BaseMapConfig = {
    name: string;
    url: string;
    attribution: string;
};

/**
 * Get the appropriate tile URL based on whether tile cache is configured
 */
const getTileUrl = (cachePrefix: string, directUrl: string): string => {
    const tileCacheUrl = env.NEXT_PUBLIC_TILE_CACHE_URL;
    if (tileCacheUrl) {
        // Remove trailing slash from cache URL if present
        const baseUrl = tileCacheUrl.replace(/\/$/, "");
        return `${baseUrl}${cachePrefix}/{z}/{x}/{y}.png`;
    }
    return directUrl;
};

export const BASE_MAPS: Record<string, BaseMapConfig> = {
    openstreetmap: {
        name: "OpenStreetMap",
        url: getTileUrl(
            "/osm",
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        ),
        attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
    opentopomap: {
        name: "OpenTopoMap",
        url: getTileUrl(
            "/otp",
            "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
        ),
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
        url: getTileUrl(
            "/orm",
            "https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png",
        ),
        attribution:
            'Railway data: &copy; <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>',
    },
};

export type BaseMapKey = keyof typeof BASE_MAPS;
export type OverlayKey = keyof typeof OVERLAYS;
