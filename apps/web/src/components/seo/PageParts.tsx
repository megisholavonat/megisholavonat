// Building blocks of the pages beside the map (station, train, delay card,
// stats, privacy, not found), with PageMain (the column) and PageHeader
// (where the page sits, the way back).

import { getMavRouteName } from "@megisholavonat/core/mavRoutes";
import { Map as MapIcon, SearchX } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { glyphText } from "@/lib/og/model";
import { jsonLd } from "@/lib/seo/metadata";
import { cn } from "@/lib/utils";
import { mnr2007 } from "@/util/fonts";
import { PageMain } from "./PageMain";

/** The page's main action: the live map, on this station or train. */
export function MapLink({ href, label }: { href: string; label: string }) {
    return (
        <Button
            variant="primary"
            asChild
            className="self-stretch sm:self-start"
        >
            <Link href={href}>
                <MapIcon className="size-5" aria-hidden />
                {label}
            </Link>
        </Button>
    );
}

/** Nothing to show here (an unknown train, station or run): where to go. */
export function EmptyPage({
    title,
    hint,
    action,
}: {
    title: string;
    hint: string;
    action: { href: string; label: string };
}) {
    return (
        <PageMain
            width="narrow"
            className="items-center justify-center gap-3 text-center"
        >
            <span className="flex size-12 items-center justify-center rounded-full bg-surface-2 text-ink-2">
                <SearchX className="size-6" aria-hidden />
            </span>
            <h1 className="text-title font-bold">{title}</h1>
            <p className="max-w-xs text-ink-2">{hint}</p>
            <Button variant="secondary" asChild className="mt-2">
                <Link href={action.href}>{action.label}</Link>
            </Button>
        </PageMain>
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
            className={cn(
                "flex flex-col gap-3 rounded-lg bg-surface p-4",
                className,
            )}
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
    const name = getMavRouteName(routeShortName);
    const style = cn(
        mnr2007.className,
        "inline-block shrink-0 leading-none",
        className,
    );
    if (!name) {
        return (
            <span aria-hidden className={style}>
                {text}
            </span>
        );
    }
    return (
        <span role="img" aria-label={name} title={name} className={style}>
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
