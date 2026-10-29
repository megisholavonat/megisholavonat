import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
    server: {
        // The API for server-side requests (link previews): the in-cluster
        // service in production. Never derived from the request's Host.
        API_URL: z.url().default("http://localhost:8000"),
        // Public origin of the site, for og:url and metadataBase
        SITE_URL: z.url().default("https://megisholavonat.info"),
    },
    runtimeEnv: {
        API_URL: process.env.API_URL,
        SITE_URL: process.env.SITE_URL,
    },
    // Skip validation during build if needed
    skipValidation:
        !!process.env.SKIP_ENV_VALIDATION ||
        !!process.env.SKIP_SERVER_ENV_VALIDATION,
});
