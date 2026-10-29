import { getPosthogKey } from "@megisholavonat/api-client";
import {
    type AnalyticsMode,
    createAnalytics,
    type EventProps,
} from "@megisholavonat/core/analytics";
import Constants from "expo-constants";
import { PostHog } from "posthog-react-native";
import { Platform } from "react-native";
import type { AnalyticsConsent } from "./settings/settings";

// Product analytics in the app, with the web's consent model:
//
// - No decision yet, or rejected: PostHog keeps everything in memory
//   (`persistence: "memory"`). Nothing is written to the device, and the
//   random id lives only until the app is closed. posthog-react-native has
//   no cookieless mode (the server-side daily hash the web uses), so this is
//   the closest equivalent: anonymous, per launch, nothing stored.
// - Accepted: a random id kept on the device (expo-file-system), so returns
//   can be counted.
//
// Switching closes the old client (flushing what it holds) and starts a new
// one with a fresh id, so nothing from before a decision is linked to the
// person after it. Leaving the persistent mode resets the stored id first.
//
// posthog-react-native is plain JavaScript; it needs no native module of its
// own. Its optional extras (expo-device, expo-application for device and
// app properties, session replay) are not installed: the app version is sent
// as our own super property.

const HOST = "https://eu.i.posthog.com";

export const analytics = createAnalytics(
    Platform.OS === "ios" ? "ios" : "android",
);
analytics.setSuperProps({
    app_version: Constants.expoConfig?.version ?? undefined,
});

export const track: typeof analytics.track = (event, props, options) =>
    analytics.track(event, props, options);

let client: PostHog | null = null;
let clientMode: AnalyticsMode | null = null;
let key: Promise<string | null> | null = null;
let generation = 0;

const modeFor = (consent: AnalyticsConsent): AnalyticsMode =>
    consent === "granted" ? "persistent" : "anonymous";

function posthogKey(): Promise<string | null> {
    key ??= getPosthogKey()
        .then(({ data }) => data?.key ?? null)
        .catch(() => null)
        .then((value) => {
            if (!value) key = null;
            return value;
        });
    return key;
}

/** Starts PostHog, or switches its mode, according to the stored choice. */
export async function applyConsent(consent: AnalyticsConsent) {
    const mode = modeFor(consent);
    analytics.setMode(mode);
    // Analytics are never sent from development builds
    if (__DEV__) return;
    if (client && clientMode === mode) return;
    const run = ++generation;

    const previous = client;
    const previousMode = clientMode;
    client = null;
    clientMode = null;
    analytics.attach(null);
    if (previous) {
        if (previousMode === "persistent") previous.reset();
        await previous.shutdown().catch(() => undefined);
    }

    const apiKey = await posthogKey();
    if (!apiKey || run !== generation) return;
    const next = new PostHog(apiKey, {
        host: HOST,
        persistence: mode === "persistent" ? "file" : "memory",
        personProfiles: "identified_only",
        // Our own app_open instead
        captureAppLifecycleEvents: false,
        enableSessionReplay: false,
        disableSurveys: true,
        preloadFeatureFlags: false,
    });
    client = next;
    clientMode = mode;
    analytics.attach({
        capture: (event, properties, { instant }) => {
            next.capture(event, properties);
            if (instant) void next.flush().catch(() => undefined);
        },
    });
}

// --- Entry points ---------------------------------------------------------

type Entry = NonNullable<EventProps<"train_opened">["entry"]>;
let pending: { entry: Entry; at: number } | null = null;

/** Where the next train or station opening comes from (for a few seconds). */
export function noteEntry(entry: Entry) {
    pending = { entry, at: Date.now() };
}

/** The entry noted for the opening happening now, if it is recent. */
export function takeEntry(): Entry | null {
    const noted = pending;
    pending = null;
    return noted && Date.now() - noted.at < 10_000 ? noted.entry : null;
}

// --- Follows and alerts --------------------------------------------------

/** A saved follow, with what the permission prompt answered. */
export function trackFollowSaved(
    days: number,
    isNew: boolean,
    permission: { granted: boolean; canAskAgain: boolean } | null,
) {
    const result = !permission
        ? "undetermined"
        : permission.granted
          ? "granted"
          : permission.canAskAgain
            ? "undetermined"
            : "denied";
    track("notification_permission_result", { result });
    track("follow_saved", {
        kind: days > 0 ? "commute" : "single",
        days,
        is_new: isNew,
        alerts: result === "granted",
    });
    track("follow_alerts_changed", { enabled: result === "granted" });
}
