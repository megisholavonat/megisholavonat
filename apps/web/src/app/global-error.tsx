"use client";

import { Geist } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";
import "@/app/globals.css";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
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
        <html lang="hu" className={geistSans.variable}>
            <body className="min-h-screen bg-background font-sans text-foreground antialiased">
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
                        <h1 className="text-xl font-semibold tracking-tight">
                            Valami hiba történt / Something went wrong
                        </h1>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                        <Link
                            href="/"
                            className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-card-foreground shadow-sm hover:bg-accent"
                        >
                            Vissza / Back
                        </Link>
                    </div>
                </div>
            </body>
        </html>
    );
}
