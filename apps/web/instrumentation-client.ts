import posthog from "posthog-js";

const posthogKey = await fetch("/api/posthog")
    .then((res) => res.json())
    .then((data) => data.key);

if (process.env.NODE_ENV !== "development" && posthogKey) {
    posthog.init(posthogKey, {
        api_host: "/relay-OfoJ",
        ui_host: "https://eu.posthog.com",
        defaults: "2025-05-24",
        capture_exceptions: true,
        // debug: env.NODE_ENV === "development",
    });
}
