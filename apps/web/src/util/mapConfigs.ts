/**
 * Get the appropriate tile URL based on whether tile cache is configured
 */
const getTileUrl = (cachePrefix: string, directUrl: string): string => {
    // Read directly: env/client brings zod into the map's bundle just for
    // this. next.config still validates it at build time.
    const tileCacheUrl = process.env.NEXT_PUBLIC_TILE_CACHE_URL;
    if (tileCacheUrl) {
        const baseUrl = tileCacheUrl.replace(/\/$/, "");
        return `${baseUrl}${cachePrefix}/{z}/{x}/{y}.png`;
    }
    return directUrl;
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

export type OverlayKey = keyof typeof OVERLAYS;
