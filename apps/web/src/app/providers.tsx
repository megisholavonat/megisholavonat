"use client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import type * as React from "react";
import { getQueryClient } from "@/clients/query";
import { ThemeProvider } from "@/components/ui/ThemeProvider";
import { NuqsAdapter } from "nuqs/adapters/next/app";

export default function Providers({ children }: { children: React.ReactNode }) {
    const queryClient = getQueryClient();

    return (
        <QueryClientProvider client={queryClient}>
            <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
                <NuqsAdapter>{children}</NuqsAdapter>
                {process.env.NODE_ENV === "development" && (
                    <ReactQueryDevtools buttonPosition="bottom-left" />
                )}
            </ThemeProvider>
        </QueryClientProvider>
    );
}
