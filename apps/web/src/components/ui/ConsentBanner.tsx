"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useAnalyticsConsent } from "@/hooks/useAnalyticsConsent";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** Session-only flag, so the banner keeps showing after a reload. */
const PROMPT_READY_KEY = "mhav.consent.prompt";
/** Ask after this much visible time on the site... */
const PROMPT_AFTER_MS = 60_000;
// ...or after the user has closed a train panel, whichever comes first.

// Equal weight for both answers: no nudging towards "accept"
const buttonClassName =
    "pressable h-11 cursor-pointer rounded-md border-[1.5px] border-ink bg-surface text-[15px] font-semibold text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

function readPromptReady(): boolean {
    try {
        return sessionStorage.getItem(PROMPT_READY_KEY) === "1";
    } catch {
        return false;
    }
}

/**
 * Becomes true once the user has had a chance to use the app: after a
 * train panel was closed (the selection is mirrored in `?vehicleId=`), or
 * after about a minute of visible time.
 */
function usePromptReady(enabled: boolean): boolean {
    const [ready, setReady] = useState(false);
    const vehicleId = useSearchParams().get("vehicleId");
    const previousVehicleId = useRef(vehicleId);

    useEffect(() => {
        if (readPromptReady()) setReady(true);
    }, []);

    useEffect(() => {
        if (ready) {
            try {
                sessionStorage.setItem(PROMPT_READY_KEY, "1");
            } catch {
                // Storage unavailable: ask again after the next reload.
            }
        }
    }, [ready]);

    useEffect(() => {
        if (previousVehicleId.current && !vehicleId) setReady(true);
        previousVehicleId.current = vehicleId;
    }, [vehicleId]);

    useEffect(() => {
        if (!enabled || ready) return;
        let visibleMs = 0;
        const tick = 1000;
        const interval = setInterval(() => {
            if (document.visibilityState !== "visible") return;
            visibleMs += tick;
            if (visibleMs >= PROMPT_AFTER_MS) setReady(true);
        }, tick);
        return () => clearInterval(interval);
    }, [enabled, ready]);

    return ready;
}

/**
 * Whether a train or station is open (mirrored in the URL by the map). The
 * card waits until it is closed, so it never sits on a sheet or a panel.
 */
function useSelectionOpen(): boolean {
    const params = useSearchParams();
    return !!(params.get("vehicleId") || params.get("station"));
}

const EASE_SHEET = [0.32, 0.72, 0, 1] as const;

/**
 * Non-modal analytics prompt. On the map it floats above the legend and the
 * locate button (which sit just above the bottom sheet), below the sheets,
 * the search and the dialogs in z-order, and steps aside while a train or
 * station is open.
 */
export default function ConsentBanner() {
    const t = useTranslations("Consent");
    const [consent, setConsent] = useAnalyticsConsent();
    const pathname = usePathname();
    const promptReady = usePromptReady(consent === "pending");
    const selectionOpen = useSelectionOpen();
    const reduceMotion = useReducedMotion() ?? false;
    const onMap = pathname === "/";

    const show =
        consent === "pending" && promptReady && !(onMap && selectionOpen);

    return (
        <AnimatePresence>
            {show && (
                <motion.section
                    key="consent"
                    aria-labelledby="consent-title"
                    initial={{ opacity: 0, y: reduceMotion ? 0 : 16 }}
                    animate={{
                        opacity: 1,
                        y: 0,
                        transition: {
                            duration: reduceMotion ? 0.15 : 0.32,
                            ease: EASE_SHEET,
                        },
                    }}
                    exit={{
                        opacity: 0,
                        y: reduceMotion ? 0 : 16,
                        transition: { duration: 0.2, ease: "easeIn" },
                    }}
                    className={cn(
                        "floating-card fixed inset-x-4 z-[25] flex flex-col gap-3 rounded-lg p-4 transition-[bottom] duration-300 ease-sheet dark:ring-1 dark:ring-line md:right-auto md:w-80",
                        onMap
                            ? // Above the legend / locate row: sheet + 36 px + 44 px + 12 px
                              "bottom-[calc(var(--mhav-sheet-inset,0px)+5.75rem)] md:bottom-16"
                            : "bottom-[max(env(safe-area-inset-bottom),16px)] md:bottom-4 md:left-4",
                    )}
                >
                    <div className="flex items-baseline justify-between gap-3">
                        <h2 id="consent-title" className="text-headline">
                            {t("title")}
                        </h2>
                        {pathname !== "/privacy" && (
                            <Link
                                href="/privacy"
                                className="text-caption font-semibold text-ink underline underline-offset-2"
                            >
                                {t("details")}
                            </Link>
                        )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            className={buttonClassName}
                            onClick={() => setConsent("denied")}
                        >
                            {t("reject")}
                        </button>
                        <button
                            type="button"
                            className={buttonClassName}
                            onClick={() => setConsent("granted")}
                        >
                            {t("accept")}
                        </button>
                    </div>
                </motion.section>
            )}
        </AnimatePresence>
    );
}
