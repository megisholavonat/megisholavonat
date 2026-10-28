import { applyConsent } from "@/lib/analytics";

// PostHog only starts if the user has agreed to analytics (see ConsentBanner).
applyConsent();
