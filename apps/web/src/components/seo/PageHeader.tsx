"use client";

import type { Locale } from "@megisholavonat/core/i18n";
import { mapPath } from "@megisholavonat/core/links";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { AppIcon } from "@/components/ui/AppIcon";
import { cameFromMap } from "@/lib/landing";
import { cn } from "@/lib/utils";

/**
 * Where the page sits and the way back, the same on every page beside the
 * map: "Mégis hol a vonat? › Állomás", the app's name linked to the map,
 * then the page's title. Opened from the map, the link goes back to it as
 * it was left (its train or station still open); otherwise it opens the map.
 */
export function PageHeader({
    current,
    title,
    caption,
    titleClassName,
    children,
}: {
    /** What kind of page this is ("Állomás"); left out when the title says it */
    current?: string;
    title: ReactNode;
    caption?: ReactNode;
    titleClassName?: string;
    /** Below the title (a train's route) */
    children?: ReactNode;
}) {
    const tHome = useTranslations("Home");
    const locale = useLocale() as Locale;
    const router = useRouter();
    return (
        <header className="flex flex-col gap-1">
            <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
                <ol className="flex min-w-0 items-center gap-1">
                    <li className="shrink-0">
                        <Link
                            href={mapPath(locale)}
                            onClick={(event) => {
                                if (!cameFromMap()) return;
                                event.preventDefault();
                                router.back();
                            }}
                            className="-mx-1 flex items-center gap-2 rounded-sm px-1 py-2 whitespace-nowrap hover:text-ink hover:underline"
                        >
                            <AppIcon size={20} />
                            {tHome("app_title")}
                        </Link>
                    </li>
                    {current && (
                        <>
                            <li aria-hidden className="shrink-0">
                                <ChevronRight className="size-3.5" />
                            </li>
                            <li
                                aria-current="page"
                                className="min-w-0 truncate"
                            >
                                {current}
                            </li>
                        </>
                    )}
                </ol>
            </nav>
            <h1
                className={cn(
                    "mt-3 text-title font-bold text-balance",
                    titleClassName,
                )}
            >
                {title}
            </h1>
            {caption && <p className="text-subhead text-ink-2">{caption}</p>}
            {children}
        </header>
    );
}
