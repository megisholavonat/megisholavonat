import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
    client: {
        NEXT_PUBLIC_TILE_CACHE_URL: z.url().optional(),
    },
    runtimeEnv: {
        NEXT_PUBLIC_TILE_CACHE_URL: process.env.NEXT_PUBLIC_TILE_CACHE_URL,
    },
    // Skip validation during build if needed
    skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
