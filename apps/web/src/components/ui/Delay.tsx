import { type DelayLevel, getDelayLevel } from "@megisholavonat/core/delay";
import { MARKER } from "@megisholavonat/core/tokens";
import { useTranslations } from "next-intl";
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

/** "+23" (always with a sign) for a delay in minutes. */
export function formatDelay(delay: number): string {
    return MARKER.label.delayed(delay);
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
    return (
        <span className={cn("tnum font-bold", TEXT_CLASS[level], className)}>
            {onTime ? t("on_time") : formatDelay(delay)}
            {stale && !onTime ? "?" : ""}
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

/** The big "+23" tile of the train sheet; "pontos" when on time. */
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
    const onTime = getDelayLevel(delay) === "onTime";
    return (
        <div
            className={cn(
                "flex shrink-0 items-center justify-center rounded-lg px-2",
                size === "lg" ? "h-16 min-w-18" : "h-12 min-w-14",
                TINT_CLASS[level],
                stale && "border border-dashed border-stale",
            )}
        >
            <span
                className={cn(
                    "tnum font-extrabold tracking-tight",
                    onTime
                        ? "text-headline"
                        : size === "lg"
                          ? "text-[32px] leading-none"
                          : "text-title",
                    TEXT_CLASS[level],
                )}
            >
                {onTime ? t("on_time") : formatDelay(delay)}
                {stale && !onTime ? "?" : ""}
            </span>
        </div>
    );
}
