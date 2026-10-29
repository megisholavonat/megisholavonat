"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/** Marks the element that opens a layer, so a remounted copy is found again */
export const FOCUS_KEY = "data-focus-key";
/** Marks the layer's own UI: focus left there is not the user's choice */
export const FOCUS_LAYER = "data-focus-layer";

/** How long to wait for the layer underneath to be back (its exit, remount) */
const RETURN_TIMEOUT_MS = 1000;
const RETURN_POLL_MS = 50;

interface Opener {
    el: HTMLElement;
    key: string | null;
}

function isShown(el: Element): el is HTMLElement {
    return (
        el instanceof HTMLElement &&
        el.isConnected &&
        el.getClientRects().length > 0 &&
        !el.closest("[inert],[aria-hidden='true']")
    );
}

/** Where focus should go back to: the opener, or its remounted copy. */
export function findOpener(opener: Opener): HTMLElement | null {
    if (isShown(opener.el)) return opener.el;
    if (!opener.key) return null;
    const copy = document.querySelector(
        `[${FOCUS_KEY}="${CSS.escape(opener.key)}"]`,
    );
    return copy && isShown(copy) ? copy : null;
}

/** Focus is free to move back: nothing, or only the closing layer, holds it */
function focusIsFree(): boolean {
    const active = document.activeElement;
    return (
        !active ||
        active === document.body ||
        !active.isConnected ||
        !!active.closest(`[${FOCUS_LAYER}]`)
    );
}

/**
 * A layer (the train) that opens over another: when it closes, by Esc, its
 * close button or the back button, focus goes back to the element that
 * opened it, e.g. a board row, and not to <body>. A row that was remounted
 * meanwhile is found again by its FOCUS_KEY.
 */
export function useFocusReturn(openKey: string | null) {
    const lastFocus = useRef<HTMLElement | null>(null);
    const opener = useRef<Opener | null>(null);
    const prev = useRef<string | null>(openKey);

    useEffect(() => {
        const onFocus = (e: FocusEvent) => {
            const target = e.target;
            if (!(target instanceof HTMLElement)) return;
            if (target === document.body) return;
            if (target.closest(`[${FOCUS_LAYER}]`)) return;
            lastFocus.current = target;
        };
        document.addEventListener("focusin", onFocus);
        return () => document.removeEventListener("focusin", onFocus);
    }, []);

    // Before any child effect can move focus into the new layer
    useLayoutEffect(() => {
        const was = prev.current;
        prev.current = openKey;
        if (!was && openKey) {
            const el = lastFocus.current;
            opener.current = el
                ? {
                      el,
                      key:
                          el
                              .closest(`[${FOCUS_KEY}]`)
                              ?.getAttribute(FOCUS_KEY) ?? null,
                  }
                : null;
        }
    }, [openKey]);

    useEffect(() => {
        if (openKey) return;
        const target = opener.current;
        opener.current = null;
        if (!target) return;
        const started = performance.now();
        let handle: ReturnType<typeof setTimeout> | null = null;
        const attempt = () => {
            handle = null;
            if (!focusIsFree()) return;
            const el = findOpener(target);
            if (el) {
                el.focus({ preventScroll: true });
                return;
            }
            if (performance.now() - started < RETURN_TIMEOUT_MS) {
                handle = setTimeout(attempt, RETURN_POLL_MS);
            }
        };
        attempt();
        return () => {
            if (handle !== null) clearTimeout(handle);
        };
    }, [openKey]);
}
