"use client";

import { type DelayLevel, getDelayLevel } from "@megisholavonat/core/delay";
import { MARKER, MOTION } from "@megisholavonat/core/tokens";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { TapTip } from "@/components/ui/TapTip";
import { cn } from "@/lib/utils";

export type Level = DelayLevel | "stale";

export const TEXT_CLASS: Record<Level, string> = {
    onTime: "text-delay-on-time",
    slight: "text-delay-slight",
    moderate: "text-delay-moderate",
    severe: "text-delay-severe",
    stale: "text-stale",
};

export const TINT_CLASS: Record<Level, string> = {
    onTime: "bg-delay-on-time-tint",
    slight: "bg-delay-slight-tint",
    moderate: "bg-delay-moderate-tint",
    severe: "bg-delay-severe-tint",
    stale: "bg-surface-2",
};

export const FILL_CLASS: Record<Level, string> = {
    onTime: "bg-delay-on-time-fill",
    slight: "bg-delay-slight-fill",
    moderate: "bg-delay-moderate-fill",
    severe: "bg-delay-severe-fill",
    stale: "bg-stale-fill",
};

export function levelOf(delay: number, stale = false): Level {
    return stale ? "stale" : getDelayLevel(delay);
}

/** Signed minutes: "+23", "0", "−2" (a real minus sign for early trains). */
export function formatDelay(delay: number): string {
    const minutes = Math.round(delay);
    if (minutes > 0) return MARKER.label.delayed(minutes);
    if (minutes < 0) return `−${-minutes}`;
    return "0";
}

/**
 * Text that rolls to its new value: the old one slides out, the new one in
 * from the direction of change (up when it grows). 200 ms, standard easing;
 * it simply swaps with reduced motion.
 */
export function RollingText({
    value,
    order,
    className,
}: {
    value: string;
    /** Numeric order of the value, to pick the roll direction */
    order: number;
    className?: string;
}) {
    const reduce = useReducedMotion();
    const [previous, setPrevious] = useState(order);
    const [direction, setDirection] = useState(1);
    if (order !== previous) {
        setPrevious(order);
        setDirection(order > previous ? 1 : -1);
    }
    if (reduce) return <span className={className}>{value}</span>;
    const { duration, easing } = MOTION.delayChange;
    return (
        <span
            className={cn(
                "relative inline-flex overflow-hidden align-bottom",
                className,
            )}
        >
            <AnimatePresence
                initial={false}
                mode="popLayout"
                custom={direction}
            >
                <motion.span
                    key={value}
                    custom={direction}
                    variants={{
                        enter: (d: number) => ({ y: `${d * 70}%`, opacity: 0 }),
                        center: { y: 0, opacity: 1 },
                        exit: (d: number) => ({ y: `${-d * 70}%`, opacity: 0 }),
                    }}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{
                        duration: duration / 1000,
                        ease: [...easing.bezier],
                    }}
                    className="inline-block"
                >
                    {value}
                </motion.span>
            </AnimatePresence>
        </span>
    );
}

/** Delay as coloured text: "pontos" or "+7". Stale delays get a "?". */
export function DelayText({
    delay,
    stale = false,
    className,
}: {
    delay: number;
    stale?: boolean;
    className?: string;
}) {
    const t = useTranslations("Delay");
    const level = levelOf(delay, stale);
    const onTime = getDelayLevel(delay) === "onTime";
    const label = `${onTime ? t("on_time") : formatDelay(delay)}${stale && !onTime ? "?" : ""}`;
    return (
        <span className={cn("tnum font-bold", TEXT_CLASS[level], className)}>
            <RollingText value={label} order={onTime ? 0 : delay} />
        </span>
    );
}

/** Tinted chip for lists and boards: "pontos", "+5", "+74". */
export function DelayChip({
    delay,
    stale = false,
    className,
}: {
    delay: number;
    stale?: boolean;
    className?: string;
}) {
    const level = levelOf(delay, stale);
    return (
        <span
            className={cn(
                "inline-flex h-5 items-center rounded-full px-1.5 text-caption font-bold",
                TINT_CLASS[level],
                stale && "border border-dashed border-stale",
                className,
            )}
        >
            <DelayText delay={delay} stale={stale} className="font-bold" />
        </span>
    );
}

/**
 * The big delay tile of the train sheet. It always shows the minutes ("+23",
 * "0", "−2"); within the on-time band a small "pontos" (or "korán") caption
 * says what the number means. Stale data reads "+23?" on a dashed tile. Tap
 * for how the delay is computed.
 */
export function DelayTile({
    delay,
    stale = false,
    size = "lg",
}: {
    delay: number;
    stale?: boolean;
    size?: "md" | "lg";
}) {
    const t = useTranslations("Delay");
    const level = levelOf(delay, stale);
    const minutes = Math.round(delay);
    const caption =
        stale || getDelayLevel(minutes) !== "onTime"
            ? null
            : minutes < 0
              ? t("early")
              : t("on_time");
    const label = `${formatDelay(minutes)}${stale ? "?" : ""}`;
    return (
        <TapTip
            content={t("note")}
            label={t("tile_label", { delay: label })}
            className="shrink-0 rounded-lg"
        >
            <span
                className={cn(
                    "flex flex-col items-center justify-center rounded-lg px-2",
                    size === "lg" ? "h-16 min-w-18" : "h-12 min-w-14",
                    TINT_CLASS[level],
                    stale && "border border-dashed border-stale",
                    TEXT_CLASS[level],
                )}
            >
                <RollingText
                    value={label}
                    order={minutes}
                    className={cn(
                        "tnum font-extrabold tracking-tight",
                        size === "lg"
                            ? "text-[32px] leading-none"
                            : "text-title leading-none",
                    )}
                />
                {caption && (
                    <span className="mt-0.5 text-[11px] leading-[13px] font-semibold">
                        {caption}
                    </span>
                )}
            </span>
        </TapTip>
    );
}
