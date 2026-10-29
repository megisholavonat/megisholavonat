// Server-rendered building blocks of the station and train pages.

import { getMavRouteName } from "@megisholavonat/core/mavRoutes";
import { ChevronRight, Map as MapIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { glyphText } from "@/lib/og/model";
import { jsonLd } from "@/lib/seo/metadata";
import { cn } from "@/lib/utils";
import { mnr2007 } from "@/util/fonts";

export function PageMain({ children }: { children: ReactNode }) {
    return (
        <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-4 px-4 pt-[calc(env(safe-area-inset-top)+16px)] pb-[max(env(safe-area-inset-bottom),32px)] lg:pt-10">
            {children}
        </main>
    );
}

/** "Mégis hol a vonat? › Állomás": where the page sits, linked home. */
export function Breadcrumb({
    home,
    homeHref,
    current,
}: {
    home: string;
    homeHref: string;
    current: string;
}) {
    return (
        <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
            <ol className="flex items-center gap-1">
                <li>
                    <Link
                        href={homeHref}
                        className="-mx-1 rounded-sm px-1 py-2 hover:text-ink hover:underline"
                    >
                        {home}
                    </Link>
                </li>
                <li aria-hidden>
                    <ChevronRight className="size-3.5" />
                </li>
                <li aria-current="page">{current}</li>
            </ol>
        </nav>
    );
}

/** The page's main action: the live map, on this station or train. */
export function MapLink({ href, label }: { href: string; label: string }) {
    return (
        <Link
            href={href}
            className="pressable flex h-12 items-center justify-center gap-2 self-stretch rounded-full bg-action px-6 text-[15px] font-semibold text-on-action sm:self-start"
        >
            <MapIcon className="size-5" aria-hidden />
            {label}
        </Link>
    );
}

export function Section({
    title,
    caption,
    children,
    className,
}: {
    title: ReactNode;
    caption?: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    return (
        <section
            className={cn("flex flex-col gap-3 rounded-lg bg-surface p-4", className)}
        >
            <header className="flex flex-col">
                <h2 className="text-headline">{title}</h2>
                {caption && <p className="text-sm text-ink-2">{caption}</p>}
            </header>
            {children}
        </section>
    );
}

/** MÁV route or category glyph, as text in the MNR2007 font. */
export function Glyph({
    routeShortName,
    className,
}: {
    routeShortName: string | null | undefined;
    className?: string;
}) {
    const text = glyphText(routeShortName);
    if (!text || !routeShortName) return null;
    const name = getMavRouteName(routeShortName) ?? undefined;
    return (
        <span
            role={name ? "img" : undefined}
            aria-label={name}
            aria-hidden={name ? undefined : true}
            title={name}
            className={cn(
                mnr2007.className,
                "inline-block shrink-0 leading-none",
                className,
            )}
        >
            {text}
        </span>
    );
}

/** Structured data for search engines. */
export function JsonLd({ data }: { data: unknown }) {
    return (
        <script
            type="application/ld+json"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped JSON
            dangerouslySetInnerHTML={{ __html: jsonLd(data) }}
        />
    );
}
