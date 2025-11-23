import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
    server: {
        POSTHOG_KEY: z.string(),
    },
    runtimeEnv: {
        POSTHOG_KEY: process.env.POSTHOG_KEY,
    },
    // Skip validation during build if needed
    skipValidation:
        !!process.env.SKIP_ENV_VALIDATION ||
        !!process.env.SKIP_SERVER_ENV_VALIDATION,
});
