// EXPO_PUBLIC_* variables are inlined at bundle time. Preview, beta and
// production builds get them from eas.json; the development profile from the EAS
// "development" environment; Metro reads apps/mobile/.env (see .env.example).
// Every API request (client, map data, Live Activity tokens) uses API_URL.

/**
 * Production API, its own host (paths /v1/...). Store builds keep this address
 * for good; the web uses same-origin /api instead.
 */
export const PROD_API_URL = "https://api.megisholavonat.info";

/** Public API base: production unless the build says otherwise. */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? PROD_API_URL;

/** The website, for share links and the privacy notice. */
export const WEB_URL = "https://megisholavonat.info";

export const SOURCE_URL = "https://github.com/megisholavonat/megisholavonat";

/** Tile cache in front of OpenRailwayMap. */
export const TILE_CACHE_URL =
    process.env.EXPO_PUBLIC_TILE_CACHE_URL ?? "https://tc.megisholavonat.info";
