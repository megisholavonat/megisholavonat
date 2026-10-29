// EXPO_PUBLIC_* variables are inlined at bundle time. Preview and production
// builds get them from eas.json; the development profile from the EAS
// "development" environment; Metro reads apps/mobile/.env (see .env.example).
// Every API request (client, map data, Live Activity tokens) uses API_URL.

/** Public API base. In production the ingress serves the API under /api. */
export const API_URL =
    process.env.EXPO_PUBLIC_API_URL ?? "https://megisholavonat.info/api";

/** The website, for share links and the privacy notice. */
export const WEB_URL = "https://megisholavonat.info";

export const SOURCE_URL = "https://github.com/megisholavonat/megisholavonat";

/** Tile cache in front of OpenRailwayMap. */
export const TILE_CACHE_URL =
    process.env.EXPO_PUBLIC_TILE_CACHE_URL ?? "https://tc.megisholavonat.info";
