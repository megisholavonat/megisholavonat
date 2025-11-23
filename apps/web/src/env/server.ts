import { createEnv } from "@t3-oss/env-nextjs";
// import { z } from "zod";

export const env = createEnv({
    server: {},
    runtimeEnv: {},
    // Skip validation during build if needed
    skipValidation:
        !!process.env.SKIP_ENV_VALIDATION ||
        !!process.env.SKIP_SERVER_ENV_VALIDATION,
});
