"use client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import type * as React from "react";
import { getQueryClient } from "@/clients/query";
import { AnalyticsRoot } from "@/components/AnalyticsRoot";
import { ThemeProvider } from "@/components/ui/ThemeProvider";
import { rememberLanding } from "@/lib/landing";

// Before any client navigation: the stats back button needs the first page
rememberLanding();

export default function Providers({ children }: { children: React.ReactNode }) {
    const queryClient = getQueryClient();

    return (
        <QueryClientProvider client={queryClient}>
            <ThemeProvider>
                <NuqsAdapter>{children}</NuqsAdapter>
                <AnalyticsRoot />
                {process.env.NODE_ENV === "development" && (
                    <ReactQueryDevtools buttonPosition="bottom-left" />
                )}
            </ThemeProvider>
        </QueryClientProvider>
    );
}
