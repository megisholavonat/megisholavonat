/** How often (ms) the vehicle position feed is polled. Matches the server's update cadence. */
export const POLL_INTERVAL_MS = 60_000;

// The delay scale, in whole minutes (see `roundMinutes` in ./delay). One rule
// for the map, the sheet, the boards, the delay card, share text and the
// stats: a train up to and including ON_TIME_MAX_MIN late is on time
// ("pontos", blue); yellow starts a minute later. The API counts on time the
// same way (ON_TIME_THRESHOLD_S = 300 in apps/api/api/models/history.py).

/** At most this many whole minutes late is on time ("pontos"). */
export const ON_TIME_MAX_MIN = 5;
/** Orange from this many minutes late */
export const ORANGE_THRESHOLD = 15;
/** Red from this many minutes late */
export const RED_THRESHOLD = 60;

// Stale trains (no position update). Ported to the API as STALE_GREY_AFTER_S /
// STALE_HIDE_AFTER_S in apps/api/api/util/vehicle.py; keep both in sync.

/** Seconds without an update after which a train turns dashed grey. */
export const STALE_GREY_AFTER_S = 300;
/** Seconds without an update after which a train is hidden. */
export const STALE_HIDE_AFTER_S = 1800;
