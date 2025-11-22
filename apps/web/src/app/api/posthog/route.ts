import { NextResponse } from "next/server";
import { env } from "@/env/server";

export const GET = () => {
    return NextResponse.json({
        key: env.POSTHOG_KEY ?? null,
    });
};
