import type { TrainFeatureCollection } from "@megisholavonat/api-client";
import { useEffect, useRef } from "react";
import { track } from "../analytics";
import type { FeedState } from "./feedState";

const FEED_ERRORS = {
    offline: "feed_unreachable",
    sourceDown: "feed_down",
    empty: "feed_empty",
} as const;

/** `map_ready`, the feed's error states and the consent card on home. */
export function useHomeAnalytics(
    trains: TrainFeatureCollection | undefined,
    feed: FeedState["kind"],
    askConsent: boolean,
) {
    const ready = useRef(false);
    useEffect(() => {
        if (ready.current || !trains) return;
        ready.current = true;
        track("map_ready", {
            ms: performance.now(),
            trains: trains.features.length,
        });
    }, [trains]);

    useEffect(() => {
        if (feed in FEED_ERRORS) {
            track("error_shown", {
                kind: FEED_ERRORS[feed as keyof typeof FEED_ERRORS],
            });
        }
    }, [feed]);

    useEffect(() => {
        if (askConsent) track("consent_shown", { surface: "card" });
    }, [askConsent]);
}
