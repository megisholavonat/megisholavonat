import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Import env validation to ensure it runs during build
import "@/env/server";
import "@/env/client";

const devBackendUrl = "http://127.0.0.1:8000";
const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
    output: "standalone",
    async rewrites() {
        const rewrites = [
            {
                source: "/relay-OfoJ/static/:path*",
                destination: "https://eu-assets.i.posthog.com/static/:path*",
            },
            {
                source: "/relay-OfoJ/:path*",
                destination: "https://eu.i.posthog.com/:path*",
            },
        ];

        if (isDev) {
            console.log(
                "Development rewrites enabled, proxying /api to:",
                devBackendUrl,
            );
            rewrites.push({
                source: "/api/:path*",
                destination: `${devBackendUrl}/:path*`,
            });
        }

        return rewrites;
    },
    // This is required to support PostHog trailing slash API requests
    skipTrailingSlashRedirect: true,
};

const withNextIntl = createNextIntlPlugin();
export default withNextIntl(nextConfig);
