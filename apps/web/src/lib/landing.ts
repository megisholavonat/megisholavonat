// Where the user came from inside the app. Client navigations keep the
// document, so the paths seen since it loaded tell whether the previous
// history entry is one of ours. `document.referrer` cannot tell: it stays
// the referrer of the first load.

import { isMapPath } from "@megisholavonat/core/links";

let current: string | null = null;
let previous: string | null = null;

/** Notes the path shown now; call on load and on every client navigation. */
export function notePath(pathname: string) {
    if (pathname === current) return;
    previous = current;
    current = pathname;
}

/** Remembers the page the app was loaded on; call once at startup. */
export function rememberLanding() {
    if (current === null && typeof window !== "undefined") {
        notePath(window.location.pathname);
    }
}

/**
 * Whether the page before this one was the map, so going back returns to
 * it as it was left (its train or station is in that entry's URL).
 */
export function cameFromMap(): boolean {
    return (
        previous !== null &&
        isMapPath(previous) &&
        typeof window !== "undefined" &&
        window.location.pathname === current
    );
}
