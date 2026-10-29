import { SITE_URL } from "@megisholavonat/core/links";

// EXPO_PUBLIC_* variables are inlined at bundle time. Release builds get them
// from eas.json; local dev reads apps/mobile/.env (see .env.example).

/** Public API base. In production the ingress serves the API under /api. */
export const API_URL =
    process.env.EXPO_PUBLIC_API_URL ?? "https://megisholavonat.info/api";

/** The website, for share links and the privacy notice. */
export const WEB_URL = SITE_URL;

export const SOURCE_URL = "https://github.com/megisholavonat/megisholavonat";

/** Tile cache in front of OpenRailwayMap. */
export const TILE_CACHE_URL =
    process.env.EXPO_PUBLIC_TILE_CACHE_URL ?? "https://tc.megisholavonat.info";
