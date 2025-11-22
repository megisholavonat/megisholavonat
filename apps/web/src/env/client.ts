import { createEnv } from "@t3-oss/env-nextjs";
// import { z } from "zod";

export const env = createEnv({
    client: {},
    runtimeEnv: {},
    // Skip validation during build if needed
    skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
