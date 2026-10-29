// The page this document was loaded on. Client navigations keep the document,
// so a different path now means the user got here inside the app and the
// previous history entry is one of ours. `document.referrer` cannot tell:
// it stays the referrer of the first load.

let landing: string | null = null;

/** Remembers the page the app was loaded on; call once at startup. */
export function rememberLanding() {
    if (landing === null && typeof window !== "undefined") {
        landing = window.location.pathname;
    }
}

/** Whether going back stays in the app (not the first page loaded). */
export function cameFromApp(): boolean {
    return (
        landing !== null &&
        typeof window !== "undefined" &&
        window.location.pathname !== landing
    );
}
