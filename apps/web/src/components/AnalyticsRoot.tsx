"use client";

import { followsBucket } from "@megisholavonat/core/analytics";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { useTheme } from "@/components/ui/ThemeProvider";
import { useFollows } from "@/hooks/useFollows";
import { analytics, track } from "@/lib/analytics";

/**
 * How this page load started: a link to a train or a station opened from
 * outside (a shared link), a reload, or a plain visit.
 */
function landingEntry(): "direct" | "share_link" | "reload" {
    const navigation = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
    if (navigation?.type === "reload") return "reload";
    const params = new URLSearchParams(window.location.search);
    if (params.has("vehicleId") || params.has("station")) return "share_link";
    return "direct";
}

let opened = false;

/** The analytics super properties, and `app_open` once per page load. */
export function AnalyticsRoot() {
    const { theme } = useTheme();
    const follows = useFollows().length;
    const { locale } = useParams<{ locale?: string }>();

    useEffect(() => {
        analytics.setSuperProps({
            locale: locale === "en" ? "en" : "hu",
            theme: theme as "light" | "dark" | "system",
            follows: followsBucket(follows),
        });
    }, [locale, theme, follows]);

    useEffect(() => {
        if (opened) return;
        opened = true;
        track("app_open", { entry: landingEntry() });
    }, []);

    return null;
}
