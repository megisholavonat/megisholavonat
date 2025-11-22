import { Geist, Geist_Mono } from "next/font/google";
import "@/app/globals.css";
import "leaflet/dist/leaflet.css";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import Providers from "@/app/providers";
import { routing } from "@/i18n/routing";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});

export const metadata: Metadata = {
    title: "Mégis hol a vonat?",
    description:
        "Magyar vonattérkép alkalmazás. Késési adatokkal és egyéb hasznos információkkal.",
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
                <meta name="apple-mobile-web-app-title" content="MHaV" />
                <link
                    rel="alternate"
                    hrefLang="hu"
                    href="https://megisholavonat.info/hu"
                />
                <link
                    rel="alternate"
                    hrefLang="en"
                    href="https://megisholavonat.info/en"
                />
                <link
                    rel="alternate"
                    hrefLang="x-default"
                    href="https://megisholavonat.info/hu"
                />
            </head>
            <body
                className={`${geistSans.variable} ${geistMono.variable} antialiased`}
            >
                <Providers>
                    <NextIntlClientProvider>{children}</NextIntlClientProvider>
                </Providers>
            </body>
        </html>
    );
}
