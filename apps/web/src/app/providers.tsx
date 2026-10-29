"use client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { usePathname } from "next/navigation";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import type * as React from "react";
import { useEffect } from "react";
import { getQueryClient } from "@/clients/query";
import { AnalyticsRoot } from "@/components/AnalyticsRoot";
import { ThemeProvider } from "@/components/ui/ThemeProvider";
import { notePath, rememberLanding } from "@/lib/landing";

// Before any client navigation: the page header's way back needs the first
// page
rememberLanding();

/** Keeps the paths of client navigations, for the page header's way back. */
function PathMemory() {
    const pathname = usePathname();
    useEffect(() => notePath(pathname), [pathname]);
    return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
    const queryClient = getQueryClient();

    return (
        <QueryClientProvider client={queryClient}>
            <ThemeProvider>
                <NuqsAdapter>{children}</NuqsAdapter>
                <AnalyticsRoot />
                <PathMemory />
                {process.env.NODE_ENV === "development" && (
                    <ReactQueryDevtools buttonPosition="bottom-left" />
                )}
            </ThemeProvider>
        </QueryClientProvider>
    );
}
