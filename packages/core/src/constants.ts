/** How often (ms) the vehicle position feed is polled. Matches the server's update cadence. */
export const POLL_INTERVAL_MS = 60_000;

export const RED_THRESHOLD = 60;
export const ORANGE_THRESHOLD = 15;
export const YELLOW_THRESHOLD = 5;

// Stale trains (no position update). Ported to the API as STALE_GREY_AFTER_S /
// STALE_HIDE_AFTER_S in apps/api/api/util/vehicle.py; keep both in sync.

/** Seconds without an update after which a train turns dashed grey. */
export const STALE_GREY_AFTER_S = 300;
/** Seconds without an update after which a train is hidden. */
export const STALE_HIDE_AFTER_S = 1800;
