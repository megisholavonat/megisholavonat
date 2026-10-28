import { useSyncExternalStore } from "react";
import {
    type ConsentStatus,
    getConsent,
    setConsent,
    subscribeToConsent,
} from "@/lib/analytics";

/**
 * Current analytics consent. `null` until the stored choice has been read on
 * the client, so nothing consent-related renders during SSR or hydration.
 */
export function useAnalyticsConsent(): [
    ConsentStatus | null,
    typeof setConsent,
] {
    const status = useSyncExternalStore<ConsentStatus | null>(
        subscribeToConsent,
        getConsent,
        () => null,
    );
    return [status, setConsent];
}
