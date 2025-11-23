import { getPosthogKey } from "@megisholavonat/api-client";
import posthog from "posthog-js";

const { data: posthogKey } = await getPosthogKey();

if (process.env.NODE_ENV !== "development" && posthogKey?.key) {
    posthog.init(posthogKey.key, {
        api_host: "/relay-OfoJ",
        ui_host: "https://eu.posthog.com",
        defaults: "2025-05-24",
        capture_exceptions: true,
        // debug: env.NODE_ENV === "development",
    });
}
