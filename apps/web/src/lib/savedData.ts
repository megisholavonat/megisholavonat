import { forgetConsent } from "@/lib/analytics";

/** Everything the site stores in the browser is under this prefix. */
const PREFIX = "mhav.";

/**
 * Removes what this site saved in the browser: follows, recent stations,
 * map settings and the statistics choice (with PostHog's own keys). The
 * light/dark choice stays. None of it is stored on the server.
 */
export function clearSavedData() {
    forgetConsent();
    for (const storage of [window.localStorage, window.sessionStorage]) {
        try {
            for (const key of Object.keys(storage)) {
                if (key.startsWith(PREFIX)) storage.removeItem(key);
            }
        } catch {
            // Storage unavailable: nothing saved either
        }
    }
}
