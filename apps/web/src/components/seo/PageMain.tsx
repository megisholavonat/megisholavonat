import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const WIDTHS = {
    /** A message alone (not found) */
    narrow: "max-w-2xl",
    /** Reading pages: station, train, delay card, privacy */
    page: "max-w-3xl",
    /** Two columns on desktop (stats) */
    wide: "max-w-5xl",
} as const;

/** A page's column, clear of the notch and the home indicator. */
export function PageMain({
    width = "page",
    className,
    children,
}: {
    width?: keyof typeof WIDTHS;
    className?: string;
    children: ReactNode;
}) {
    return (
        <main
            className={cn(
                "mx-auto flex min-h-dvh w-full flex-col gap-4 px-4 pt-[calc(env(safe-area-inset-top)+16px)] pb-[max(env(safe-area-inset-bottom),32px)] lg:pt-10",
                WIDTHS[width],
                className,
            )}
        >
            {children}
        </main>
    );
}
