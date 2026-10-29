"use client";

import { ChartColumn, ChevronLeft, RefreshCw } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { parseAsInteger, useQueryState } from "nuqs";
import { type ReactNode, useId } from "react";
import { FILL_CLASS, type Level, TINT_CLASS } from "@/components/ui/Delay";
import { useRouter } from "@/i18n/navigation";
import { cameFromApp } from "@/lib/landing";
import { cn } from "@/lib/utils";
import { DEFAULT_DAYS } from "./figures";

export { DEFAULT_DAYS };

/**
 * Look-back window. Not shown in the UI; `?days=` overrides it (1-365).
 */
export function useDays(): number {
    const [days] = useQueryState("days", parseAsInteger);
    if (!days || days < 1) return DEFAULT_DAYS;
    return Math.min(days, 365);
}

import { lateLevel, MIN_SAMPLES, of10 } from "./figures";

export { lateLevel, MIN_SAMPLES, of10 };

/**
 * Ten steps, one per run out of ten: on time in blue, the rest neutral, or in
 * the delay colour when the train is usually late.
 */
export function TenBar({
    share,
    late = null,
    size = "md",
}: {
    share: number;
    late?: Level | null;
    size?: "md" | "lg";
}) {
    const onTime = of10(share);
    return (
        <span className="flex shrink-0 gap-0.5" aria-hidden>
            {Array.from({ length: 10 }, (_, i) => (
                <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed ten steps
                    key={i}
                    className={cn(
                        "rounded-[2px]",
                        size === "lg" ? "h-5 w-3" : "h-3.5 w-1.5",
                        i < onTime
                            ? "bg-delay-on-time-fill"
                            : late
                              ? FILL_CLASS[late]
                              : "bg-surface-2",
                    )}
                />
            ))}
        </span>
    );
}

/** "15+ perc" chip: how late the usual run is. */
export function LateChip({
    level,
    className,
}: {
    level: Level;
    className?: string;
}) {
    const t = useTranslations("Stats");
    return (
        <span
            title={t("usually_late")}
            className={cn(
                "inline-flex h-5 shrink-0 items-center rounded-full px-1.5 text-caption font-bold whitespace-nowrap text-ink",
                TINT_CLASS[level],
                className,
            )}
        >
            <span className="sr-only">{t("usually_late")} </span>
            {t(`late.${level}`)}
        </span>
    );
}

/** "<b>10-ből 7-szer</b> pontos" */
export function Of10Text({
    share,
    station,
}: {
    share: number;
    station?: string | null;
}) {
    const t = useTranslations("Stats");
    const count = of10(share);
    const b = (chunks: ReactNode) => <b className="font-semibold">{chunks}</b>;
    return (
        <span>
            {station
                ? t.rich("of10_at", { station, count, b })
                : t.rich("of10", { count, b })}
        </span>
    );
}

/** Page header: back, title, the window as a caption. */
export function StatsHeader({
    title,
    caption,
    fallbackHref,
    trailing,
}: {
    title: ReactNode;
    caption?: ReactNode;
    fallbackHref: string;
    trailing?: ReactNode;
}) {
    const t = useTranslations("Stats");
    const router = useRouter();
    const back = () => {
        // Back to wherever the page was opened from in the app (the map
        // keeps its selection in the URL); a direct visit goes up one level
        if (cameFromApp()) router.back();
        else router.push(fallbackHref);
    };
    return (
        <header className="flex items-start gap-2">
            <button
                type="button"
                onClick={back}
                aria-label={t("back")}
                className="pressable -ml-2 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink hover:bg-surface-2"
            >
                <ChevronLeft className="size-6" aria-hidden />
            </button>
            <div className="flex min-w-0 flex-1 flex-col pt-1.5">
                <h1 className="text-title">{title}</h1>
                {caption && <p className="text-sm text-ink-2">{caption}</p>}
            </div>
            {trailing}
        </header>
    );
}

export function Card({
    title,
    children,
    className,
}: {
    title?: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    return (
        <section
            className={cn(
                "flex animate-in flex-col gap-3 rounded-lg bg-surface p-4 duration-200 fade-in-0 motion-reduce:animate-none",
                className,
            )}
        >
            {title && <h2 className="text-headline">{title}</h2>}
            {children}
        </section>
    );
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
    const t = useTranslations("States");
    return (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-ink-2">{t("load_error")}</p>
            <button
                type="button"
                className="pressable flex h-10 cursor-pointer items-center gap-2 rounded-full bg-surface-2 px-4 text-sm font-semibold hover:bg-line"
                onClick={onRetry}
            >
                <RefreshCw className="size-4" aria-hidden />
                {t("retry")}
            </button>
        </div>
    );
}

export function RowsSkeleton({ rows = 6 }: { rows?: number }) {
    return (
        <div
            className="flex motion-safe:animate-pulse flex-col gap-5 py-2"
            aria-hidden
        >
            {Array.from({ length: rows }, (_, i) => (
                <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
                    key={i}
                    className="flex items-center gap-3"
                >
                    <span className="h-4 w-5 rounded-sm bg-surface-2" />
                    <span className="h-4 flex-1 rounded-sm bg-surface-2" />
                    <span className="h-4 w-20 rounded-sm bg-surface-2" />
                </div>
            ))}
        </div>
    );
}

/** Segmented control in the style of the station board's switch. */
export function Segmented<T extends string>({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: T;
    options: { value: T; label: string }[];
    onChange: (value: T) => void;
}) {
    const pillId = useId();
    const reduceMotion = useReducedMotion() ?? false;
    return (
        <div
            role="tablist"
            aria-label={label}
            className="grid auto-cols-fr grid-flow-col rounded-md bg-surface-2 p-0.5"
        >
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    role="tab"
                    aria-selected={value === o.value}
                    onClick={() => onChange(o.value)}
                    className={cn(
                        "relative h-9 cursor-pointer rounded-[8px] px-3 text-sm transition-colors",
                        value === o.value
                            ? "font-semibold text-ink"
                            : "text-ink-2 hover:text-ink",
                    )}
                >
                    {value === o.value && (
                        <motion.span
                            layoutId={pillId}
                            aria-hidden
                            className="absolute inset-0 rounded-[8px] bg-surface shadow-sm"
                            transition={{
                                duration: reduceMotion ? 0 : 0.24,
                                ease: [0.32, 0.72, 0, 1],
                            }}
                        />
                    )}
                    <span className="relative block truncate">{o.label}</span>
                </button>
            ))}
        </div>
    );
}

/** "Not enough data yet": a quiet chart mark, what is missing and when. */
export function EmptyState() {
    const t = useTranslations("Stats");
    return (
        <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-surface-2 text-ink-2">
                <ChartColumn className="size-6" aria-hidden />
            </span>
            <div className="flex max-w-72 flex-col gap-1">
                <p className="text-headline">{t("no_data")}</p>
                <p className="text-sm text-ink-2">{t("no_data_hint")}</p>
            </div>
        </div>
    );
}
