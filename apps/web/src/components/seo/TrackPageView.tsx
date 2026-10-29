"use client";

import type { EventProps } from "@megisholavonat/core/analytics";
import { useTrackView } from "@/lib/analyticsEvents";

/**
 * `stats_viewed` for a station or train page, as the history pages these
 * pages replaced sent it. Renders nothing.
 */
export function TrackPageView(props: EventProps<"stats_viewed">) {
    useTrackView("stats_viewed", props);
    return null;
}
