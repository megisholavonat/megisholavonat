import { createEnv } from "@t3-oss/env-nextjs";

export const env = createEnv({
    server: {},
    runtimeEnv: {},
    // Skip validation during build if needed
    skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
