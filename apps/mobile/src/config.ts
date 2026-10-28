// EXPO_PUBLIC_* variables are inlined at bundle time. Release builds get them
// from eas.json; local dev reads apps/mobile/.env (see .env.example).

/** Public API base. In production the ingress serves the API under /api. */
export const API_URL =
    process.env.EXPO_PUBLIC_API_URL ?? "https://megisholavonat.info/api";

/** Tile cache in front of OpenRailwayMap. */
export const TILE_CACHE_URL =
    process.env.EXPO_PUBLIC_TILE_CACHE_URL ?? "https://tc.megisholavonat.info";
