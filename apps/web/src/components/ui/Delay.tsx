"use client";

import type { DelayLevel } from "@megisholavonat/core/delay";
import {
    type DelayTileModel,
    delayLabel,
    delayTile,
    type TrainDisplayInput,
    trainDisplay,
} from "@megisholavonat/core/display";
import { MOTION } from "@megisholavonat/core/tokens";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { TapTip } from "@/components/ui/TapTip";
import { useNow } from "@/hooks/useNow";
import { cn } from "@/lib/utils";

export type Level = DelayLevel | "stale";

export const TEXT_CLASS: Record<Level, string> = {
    onTime: "text-delay-on-time",
    slight: "text-delay-slight",
    moderate: "text-delay-moderate",
    severe: "text-delay-severe",
    stale: "text-stale",
};

/** Backgrounds from the `DELAY_SCALE[scheme][level].tint` tokens */
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

/**
 * Delay as coloured text (core `delayLabel`): "pontos" up to +5, "+7"
 * after. A stale delay is its last number with a "?", never a confident
 * "pontos"; without a delay (an idle or cancelled train) it is a grey "–".
 */
export function DelayText({
    delay,
    stale = false,
    className,
}: {
    delay: number | null;
    stale?: boolean;
    className?: string;
}) {
    const t = useTranslations("Delay");
    const shown = delayLabel(delay, stale);
    const classes = cn("tnum font-bold", TEXT_CLASS[shown.level], className);
    if (shown.minutes == null) {
        return <span className={classes}>{shown.text}</span>;
    }
    return (
        <span className={classes}>
            <RollingText
                value={shown.text ?? t("on_time")}
                order={shown.text == null ? 0 : shown.minutes}
            />
        </span>
    );
}

/** Tinted chip for lists and boards: "pontos", "+6", "+74", "+23?", "–". */
export function DelayChip({
    delay,
    stale = false,
    className,
}: {
    delay: number | null;
    stale?: boolean;
    className?: string;
}) {
    const shown = delayLabel(delay, stale);
    return (
        <span
            className={cn(
                "inline-flex h-5 items-center rounded-full px-1.5 text-caption font-bold",
                TINT_CLASS[shown.level],
                stale && "border border-dashed border-stale",
                className,
            )}
        >
            <DelayText delay={delay} stale={stale} className="font-bold" />
        </span>
    );
}

/** Core `delayTile` for a delay as the sheet passes it around. */
export function tileOf(delay: number | null, stale: boolean): DelayTileModel {
    return delayTile({
        state: delay == null ? "idle" : stale ? "stale" : "running",
        delay,
        activity: null,
    });
}

/** The tile's "pontos" / "korán" caption (the web shows no idle captions). */
export function useTileCaption(): (tile: DelayTileModel) => string | null {
    const t = useTranslations("Delay");
    return (tile) =>
        tile.caption?.kind === "on_time"
            ? t("on_time")
            : tile.caption?.kind === "early"
              ? t("early")
              : null;
}

/**
 * The big delay tile of the train sheet (core `delayTile`). It always shows
 * the minutes ("+23", "0", "−2"); within the on-time band (up to +5) a small
 * "pontos" (or "korán") caption says what the number means. Stale data
 * reads "+23?" on a dashed tile. Tap for how the delay is computed.
 */
export function DelayTile({
    delay,
    stale = false,
    size = "lg",
}: {
    /** Null for an idle or cancelled train: a grey "–" without a caption */
    delay: number | null;
    stale?: boolean;
    size?: "md" | "lg";
}) {
    const t = useTranslations("Delay");
    const tile = tileOf(delay, stale);
    const caption = useTileCaption()(tile);
    return (
        <TapTip
            content={t("note")}
            label={t("tile_label", { delay: tile.text })}
            className="shrink-0 rounded-lg"
        >
            <span
                className={cn(
                    "flex flex-col items-center justify-center rounded-lg px-2",
                    size === "lg" ? "h-16 min-w-18" : "h-12 min-w-14",
                    TINT_CLASS[tile.level],
                    tile.stale && "border border-dashed border-stale",
                    TEXT_CLASS[tile.level],
                )}
            >
                <RollingText
                    value={tile.text}
                    order={tile.delay ?? 0}
                    className={cn(
                        "tnum font-extrabold tracking-tight",
                        size === "lg"
                            ? "text-delay-xl leading-none"
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

/**
 * Under the tile when the data is old: how old, and the delay it had
 * ("Utolsó adat 6 perce: +23 perc"), so the "?" is explained.
 */
export function StaleNote({
    note,
    className,
}: {
    note: { minutes: number; delay: string | null; onTime: boolean } | null;
    className?: string;
}) {
    const t = useTranslations("Delay");
    if (!note) return null;
    return (
        <span className={cn("text-caption text-ink-2", className)}>
            {note.delay == null
                ? t("stale_age", { minutes: note.minutes })
                : t("stale_last", {
                      minutes: note.minutes,
                      delay: note.onTime
                          ? t("on_time")
                          : t("minutes", { delay: note.delay }),
                  })}
        </span>
    );
}

/** A train's delay as text or a chip, the same as its map marker shows. */
export function TrainDelay({
    train,
    chip = false,
}: {
    train: TrainDisplayInput;
    chip?: boolean;
}) {
    const now = useNow();
    const display = trainDisplay(train, new Date(now));
    const props = {
        delay: display.delay,
        stale: display.state !== "running",
    };
    return chip ? <DelayChip {...props} /> : <DelayText {...props} />;
}
