import { COLORS } from "@megisholavonat/core/tokens";
import { themeCss } from "@megisholavonat/core/tokens/web";
import { Inter } from "next/font/google";
import "@/app/globals.css";
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { Suspense } from "react";
import Providers from "@/app/providers";
import ConsentBanner from "@/components/ui/ConsentBanner";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/og/page";
import { siteUrl } from "@/lib/og/server";

const inter = Inter({
    variable: "--font-inter",
    subsets: ["latin", "latin-ext"],
});

/** Per-URL title, description and link preview (`?vehicleId=`, `?station=`). */
export async function generateMetadata({
    params,
}: {
    params: Promise<{ locale: string }>;
}): Promise<Metadata> {
    const { locale } = await params;
    const origin = siteUrl();
    return {
        ...(await pageMetadata(
            hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
        )),
        // The map's language versions; pages with their own replace them
        alternates: {
            languages: {
                hu: `${origin}/hu`,
                en: `${origin}/en`,
                "x-default": `${origin}/hu`,
            },
        },
    };
}

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    interactiveWidget: "resizes-content",
    themeColor: [
        { media: "(prefers-color-scheme: light)", color: COLORS.light.canvas },
        { media: "(prefers-color-scheme: dark)", color: COLORS.dark.canvas },
    ],
};

export default async function LocaleLayout({
    children,
    params,
}: Readonly<{
    children: React.ReactNode;
    params: Promise<{ locale: string }>;
}>) {
    const { locale } = await params;
    if (!hasLocale(routing.locales, locale)) {
        notFound();
    }

    return (
        <html lang={locale} suppressHydrationWarning>
            <head>
                <style>{themeCss()}</style>
                <meta name="apple-mobile-web-app-title" content="MHaV" />
            </head>
            <body className={`${inter.variable} font-sans antialiased`}>
                <Providers>
                    <NextIntlClientProvider>
                        {children}
                        <Suspense fallback={null}>
                            <ConsentBanner />
                        </Suspense>
                    </NextIntlClientProvider>
                </Providers>
            </body>
        </html>
    );
}
