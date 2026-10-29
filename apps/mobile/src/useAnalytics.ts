import {
    type AnalyticsEvent,
    type EventProps,
    followsBucket,
} from "@megisholavonat/core/analytics";
import { useLinkingURL } from "expo-linking";
import { useLastNotificationResponse } from "expo-notifications";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useLocale } from "use-intl";
import { analytics, applyConsent, noteEntry, track } from "./analytics";
import { useFollows } from "./follow/store";
import { useSettings } from "./settings/SettingsProvider";

type AlertType = NonNullable<EventProps<"notification_opened">["alert_type"]>;
const ALERT_TYPES: readonly string[] = [
    "delay",
    "on_time",
    "platform",
    "train_ahead",
];

/** The alert's kind, from the push data's `kinds` list. */
function alertType(data: unknown): AlertType {
    const kinds = (data as { kinds?: unknown } | undefined)?.kinds;
    if (!Array.isArray(kinds) || kinds.length === 0) return "unknown";
    if (kinds.length > 1) return "multiple";
    const [kind] = kinds;
    return typeof kind === "string" && ALERT_TYPES.includes(kind)
        ? (kind as AlertType)
        : "unknown";
}

/** Opened through a train or station link rather than the launcher. */
const isContentLink = (url: string | null) =>
    url !== null && /\/(train|station)\//.test(url);

/**
 * The consent mode, the super properties, `app_open` (each launch and each
 * return to the foreground) and `notification_opened`.
 */
export function useAnalytics() {
    const { settings } = useSettings();
    const locale = useLocale();
    const follows = useFollows().length;
    const url = useLinkingURL();
    const notification = useLastNotificationResponse();

    useEffect(() => {
        void applyConsent(settings.analytics);
    }, [settings.analytics]);

    useEffect(() => {
        analytics.setSuperProps({
            locale: locale === "en" ? "en" : "hu",
            theme: settings.theme,
            follows: followsBucket(follows),
        });
    }, [locale, settings.theme, follows]);

    // A cold start: by an alert, a link, or the launcher. The alert and the
    // link arrive a moment after the first render.
    const latest = useRef({ notification, url });
    latest.current = { notification, url };
    const mountedAt = useRef(Date.now());
    useEffect(() => {
        const timer = setTimeout(() => {
            const { notification, url } = latest.current;
            const entry = notification
                ? "notification"
                : isContentLink(url)
                  ? "share_link"
                  : "direct";
            track("app_open", { entry });
        }, 500);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        let previous = AppState.currentState;
        const subscription = AppState.addEventListener("change", (next) => {
            if (previous && previous !== "active" && next === "active") {
                track("app_open", { entry: "direct" });
            }
            previous = next;
        });
        return () => subscription.remove();
    }, []);

    // A link to a train or station (the sheet takes it as its entry)
    useEffect(() => {
        if (isContentLink(url)) noteEntry("share_link");
    }, [url]);

    // Each tapped alert once
    const seen = useRef<string | null>(null);
    useEffect(() => {
        if (!notification) return;
        const id = notification.notification.request.identifier;
        if (seen.current === id) return;
        seen.current = id;
        noteEntry("notification");
        track("notification_opened", {
            alert_type: alertType(
                notification.notification.request.content.data,
            ),
            cold_start: Date.now() - mountedAt.current < 3000,
        });
    }, [notification]);
}

/** Sends an event once, when the screen opens. */
export function useTrackOnOpen<E extends AnalyticsEvent>(
    event: E,
    props?: EventProps<E>,
) {
    const sent = useRef(false);
    useEffect(() => {
        if (sent.current) return;
        sent.current = true;
        track(event, props);
    });
}
