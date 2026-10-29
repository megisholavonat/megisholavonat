"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useAnalyticsConsent } from "@/hooks/useAnalyticsConsent";
import { Link, usePathname } from "@/i18n/navigation";

/** Session-only flag, so the banner keeps showing after a reload. */
const PROMPT_READY_KEY = "mhav.consent.prompt";
/** Ask after this much visible time on the site... */
const PROMPT_AFTER_MS = 60_000;
// ...or after the user has closed a train panel, whichever comes first.

// Equal weight for both answers: no nudging towards "accept"
const buttonClassName =
    "h-11 cursor-pointer rounded-md border-[1.5px] border-ink bg-surface text-[15px] font-semibold text-ink transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

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

export default function ConsentBanner() {
    const t = useTranslations("Consent");
    const [consent, setConsent] = useAnalyticsConsent();
    const pathname = usePathname();
    const promptReady = usePromptReady(consent === "pending");

    if (consent !== "pending" || !promptReady) return null;

    return (
        <section
            aria-labelledby="consent-title"
            className="floating-card fixed inset-x-4 bottom-[calc(var(--mhav-sheet-inset,0px)+12px)] z-40 flex flex-col gap-3 rounded-lg p-4 md:right-auto md:bottom-16 md:w-80 [html[data-sheet=full]_&]:hidden"
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
        </section>
    );
}
