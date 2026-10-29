"use client";

import { themeCss } from "@megisholavonat/core/tokens/web";
import { Inter } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";
import "@/app/globals.css";

const inter = Inter({
    variable: "--font-inter",
    subsets: ["latin", "latin-ext"],
});

export default function GlobalError({
    error,
}: {
    error: Error & { digest?: string };
}) {
    useEffect(() => {
        console.error(error);
    }, [error]);

    return (
        <html lang="hu" className={inter.variable}>
            <head>
                <style>{themeCss()}</style>
            </head>
            <body className="min-h-screen bg-canvas font-sans text-ink antialiased">
                <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-12">
                    <Image
                        src="/icon1.png"
                        alt="Mégis hol a vonat?"
                        width={72}
                        height={72}
                        className="rounded-2xl shadow-md"
                        priority
                    />
                    <div className="max-w-md text-center">
                        <h1 className="text-title">
                            Valami hiba történt / Something went wrong
                        </h1>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                        <Link
                            href="/"
                            className="rounded-full bg-action px-5 py-2.5 text-sm font-semibold text-on-action"
                        >
                            Vissza / Back
                        </Link>
                    </div>
                </div>
            </body>
        </html>
    );
}
