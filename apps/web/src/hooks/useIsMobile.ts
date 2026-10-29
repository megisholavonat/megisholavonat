import { useSyncExternalStore } from "react";

const DESKTOP_QUERY = "(min-width: 768px)";

function subscribe(listener: () => void) {
    const mq = window.matchMedia(DESKTOP_QUERY);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
}

/** Desktop layout (side panel) from 768 px; phones get bottom sheets. */
export function useIsDesktop(): boolean {
    return useSyncExternalStore(
        subscribe,
        () => window.matchMedia(DESKTOP_QUERY).matches,
        () => true,
    );
}

export function useIsMobile(): boolean {
    return !useIsDesktop();
}
