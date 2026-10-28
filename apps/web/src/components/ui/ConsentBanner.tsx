"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useAnalyticsConsent } from "@/hooks/useAnalyticsConsent";
import { Link, usePathname } from "@/i18n/navigation";
import { Z_LAYERS } from "@/util/constants";

/** Session-only flag, so the banner keeps showing after a reload. */
const PROMPT_READY_KEY = "mhav.consent.prompt";
/** Ask after this much visible time on the site... */
const PROMPT_AFTER_MS = 60_000;
// ...or after the user has closed a train panel, whichever comes first.

const buttonClassName =
    "flex-1 cursor-pointer rounded-lg border border-gray-300 dark:border-border bg-white dark:bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-blue-50 dark:hover:bg-black/95 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

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
    const t = useTranslations("ConsentBanner");
    const [consent, setConsent] = useAnalyticsConsent();
    const pathname = usePathname();
    const promptReady = usePromptReady(consent === "pending");

    if (consent !== "pending" || !promptReady) return null;

    return (
        <section
            aria-labelledby="consent-banner-title"
            aria-describedby="consent-banner-description"
            className="fixed left-4 right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] sm:bottom-[calc(1rem+env(safe-area-inset-bottom))] sm:right-auto sm:max-w-sm bg-white/95 dark:bg-card/95 backdrop-blur-md rounded-2xl p-4 shadow-lg border border-gray-200/50 dark:border-border"
            style={{ zIndex: Z_LAYERS.HEADER }}
        >
            <h2
                id="consent-banner-title"
                className="text-sm font-semibold text-foreground"
            >
                {t("title")}
            </h2>
            <p
                id="consent-banner-description"
                className="mt-1 text-sm text-muted-foreground"
            >
                {t("description")}{" "}
                {pathname !== "/privacy" && (
                    <Link
                        href="/privacy"
                        className="underline underline-offset-2 hover:text-foreground"
                    >
                        {t("privacy_link")}
                    </Link>
                )}
            </p>
            <div className="mt-3 flex gap-2">
                <button
                    type="button"
                    className={buttonClassName}
                    onClick={() => setConsent("granted")}
                >
                    {t("accept")}
                </button>
                <button
                    type="button"
                    className={buttonClassName}
                    onClick={() => setConsent("denied")}
                >
                    {t("reject")}
                </button>
            </div>
        </section>
    );
}
