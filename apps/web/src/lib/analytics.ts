import { getPosthogKey } from "@megisholavonat/api-client";
import { createAnalytics } from "@megisholavonat/core/analytics";
import type { PostHog, PostHogConfig } from "posthog-js";
import { version } from "../../package.json";

/**
 * Analytics consent.
 *
 * - No decision yet, or rejected: PostHog runs in cookieless mode. Nothing is
 *   stored on the device and every event carries the same placeholder ID;
 *   PostHog derives a daily-rotating hash server-side, so we can count daily
 *   visitors without identifying anyone across days.
 * - Accepted: normal capture with a random ID persisted in localStorage.
 *
 * The user's choice itself is stored under {@link CONSENT_STORAGE_KEY}, which
 * is strictly necessary to remember it.
 *
 * Product events go through {@link analytics} (the typed event list in
 * `@megisholavonat/core/analytics`) in both modes. Its super properties are
 * kept in memory and added to each event, never registered in PostHog, so
 * nothing more is stored. Events queued before a decision are dropped when it
 * is made, and PostHog starts a fresh identity on opt-in, so nothing from
 * before the consent is linked to the person after it.
 */

export const CONSENT_STORAGE_KEY = "mhav.consent.analytics";

/**
 * Typed product events (see `@megisholavonat/core/analytics`). Calls made
 * before PostHog has loaded wait in a short queue.
 */
export const analytics = createAnalytics("web");
analytics.setSuperProps({ app_version: version });

export const track: typeof analytics.track = (event, props, options) =>
    analytics.track(event, props, options);

/**
 * Bump this when the analytics processing changes in a way that needs the user
 * to decide again. Stored choices with an older version are ignored.
 */
export const CONSENT_VERSION = 1;

/** After a rejection, ask again only after this long. */
const REJECTION_TTL_MS = 182 * 24 * 60 * 60 * 1000;

export type ConsentChoice = "granted" | "denied";
export type ConsentStatus = ConsentChoice | "pending";

interface StoredConsent {
    value: ConsentChoice;
    version: number;
    date: string;
}

const listeners = new Set<() => void>();

function notify() {
    for (const listener of listeners) listener();
}

function readStoredConsent(): StoredConsent | null {
    try {
        const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<StoredConsent>;
        if (
            (parsed.value !== "granted" && parsed.value !== "denied") ||
            parsed.version !== CONSENT_VERSION
        ) {
            return null;
        }
        if (
            parsed.value === "denied" &&
            !(Date.now() - Date.parse(parsed.date ?? "") < REJECTION_TTL_MS)
        ) {
            // The rejection has expired: ask again.
            return null;
        }
        return parsed as StoredConsent;
    } catch {
        // Storage unavailable or malformed value: treat as no decision.
    }
    return null;
}

export function getConsent(): ConsentStatus {
    if (typeof window === "undefined") return "pending";
    return readStoredConsent()?.value ?? "pending";
}

export function subscribeToConsent(listener: () => void): () => void {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
        if (event.key === CONSENT_STORAGE_KEY) {
            applyConsent();
            listener();
        }
    };
    window.addEventListener("storage", onStorage);
    return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
    };
}

export function setConsent(
    value: ConsentChoice,
    source: "prompt" | "settings" = "prompt",
) {
    // Sent before the switch, in the mode it was made in (cookieless unless
    // it is a withdrawal), so the acceptance rate can be measured
    analytics.track(
        "consent_decided",
        { decision: value, source },
        { instant: true },
    );
    const stored: StoredConsent = {
        value,
        version: CONSENT_VERSION,
        date: new Date().toISOString(),
    };
    try {
        localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(stored));
    } catch {
        // If storage is unavailable the choice only lasts for this page load.
    }
    applyConsent(value);
    notify();
}

// Matches PostHog's own keys: `ph_<token>_posthog`, `ph_<token>_window_id`,
// `__ph_opt_in_out_<token>`, etc.
const POSTHOG_KEY_PATTERN = /^(__)?ph_/;

/** Remove everything PostHog may have stored in this browser. */
function clearPosthogStorage() {
    for (const storage of [window.localStorage, window.sessionStorage]) {
        try {
            for (const key of Object.keys(storage)) {
                if (POSTHOG_KEY_PATTERN.test(key)) storage.removeItem(key);
            }
        } catch {
            // Storage unavailable.
        }
    }

    const hostname = window.location.hostname;
    const parts = hostname.split(".");
    // PostHog may set the cookie on the registrable domain (cross-subdomain).
    const domains = ["", hostname, `.${parts.slice(-2).join(".")}`];
    for (const cookie of document.cookie.split(";")) {
        const name = cookie.split("=")[0]?.trim();
        if (!name || !POSTHOG_KEY_PATTERN.test(name)) continue;
        for (const domain of domains) {
            // biome-ignore lint/suspicious/noDocumentCookie: removing third-party analytics cookies
            document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ""}`;
        }
    }
}

const BASE_CONFIG: Partial<PostHogConfig> = {
    api_host: "/relay-OfoJ",
    ui_host: "https://eu.posthog.com",
    defaults: "2025-05-24",
    capture_exceptions: true,
    // Once consented, keep state in localStorage only: no cookies.
    persistence: "localStorage",
    person_profiles: "identified_only",
    // Ask for as little as possible.
    disable_session_recording: true,
    mask_all_text: true,
};

type Mode = "cookieless" | "persistent";

const modeFor = (consent: ConsentStatus): Mode =>
    consent === "granted" ? "persistent" : "cookieless";

let currentMode: Mode | null = null;
let initPromise: Promise<void> | null = null;
/**
 * posthog-js, set by startPosthog before anything else touches it. It is a
 * third of the page's script, so it is fetched once the page has loaded and
 * the main thread is idle, not ahead of the map.
 */
let posthog: PostHog | undefined;
let loadPromise: Promise<PostHog> | null = null;

function loadPosthog(): Promise<PostHog> {
    loadPromise ??= new Promise<void>((resolve) => {
        const idle = () => {
            if (typeof requestIdleCallback === "function") {
                requestIdleCallback(() => resolve(), { timeout: 3000 });
            } else setTimeout(resolve, 1000);
        };
        if (document.readyState === "complete") idle();
        else window.addEventListener("load", idle, { once: true });
    })
        .then(() => import("posthog-js"))
        .then((module) => module.default)
        .catch((error: unknown) => {
            loadPromise = null;
            throw error;
        });
    return loadPromise;
}

function init(posthog: PostHog, key: string) {
    const mode = modeFor(getConsent());
    posthog.init(key, {
        ...BASE_CONFIG,
        // "always": nothing is persisted and opt-in/out is ignored.
        // "on_reject": normal capture once opted in.
        cookieless_mode: mode === "cookieless" ? "always" : "on_reject",
    });
    if (mode === "persistent" && !posthog.has_opted_in_capturing()) {
        posthog.opt_in_capturing({ captureEventName: false });
    }
    currentMode = mode;
    analytics.attach({
        capture: (event, properties, { instant }) => {
            posthog.capture(
                event,
                properties,
                instant ? { send_instantly: true } : undefined,
            );
        },
    });
}

/** Switch a running PostHog instance between cookieless and persistent. */
function switchMode(posthog: PostHog, mode: Mode) {
    if (mode === "persistent") {
        // "always" cannot be opted into, so move to "on_reject" and go through
        // an explicit opt-out: opting in from there resets PostHog and starts
        // a fresh, persisted, non-cookieless identity.
        posthog.set_config({ cookieless_mode: "on_reject" });
        posthog.opt_out_capturing();
        posthog.opt_in_capturing({ captureEventName: false });
    } else {
        // Opting out in "on_reject" resets the identity and disables
        // persistence; "always" then keeps counting without consent state.
        posthog.opt_out_capturing();
        posthog.set_config({ cookieless_mode: "always" });
        clearPosthogStorage();
    }
    currentMode = mode;
}

async function startPosthog() {
    // Analytics are never sent from local development.
    if (process.env.NODE_ENV === "development") return;

    let ph: PostHog;
    try {
        ph = await loadPosthog();
    } catch {
        return;
    }
    posthog = ph;
    if (!ph.__loaded) {
        initPromise ??= (async () => {
            const { data } = await getPosthogKey();
            if (!data?.key) {
                initPromise = null;
                return;
            }
            init(ph, data.key);
        })().catch(() => {
            initPromise = null;
        });
        await initPromise;
    }

    // The choice may have changed since PostHog was started.
    const mode = modeFor(getConsent());
    if (ph.__loaded && currentMode !== mode) switchMode(ph, mode);
}

/** Start PostHog, or switch its mode, according to the stored choice. */
export function applyConsent(value: ConsentStatus = getConsent()) {
    if (typeof window === "undefined") return;
    analytics.setMode(
        modeFor(value) === "persistent" ? "persistent" : "anonymous",
    );
    if (modeFor(value) === "cookieless" && !posthog?.__loaded) {
        // Also removes data left behind by earlier versions of the site,
        // which ran PostHog with persistence without asking.
        clearPosthogStorage();
    }
    void startPosthog();
}
