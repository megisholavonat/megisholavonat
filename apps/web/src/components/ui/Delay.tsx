import { type DelayLevel, getDelayLevel } from "@megisholavonat/core/delay";
import {
    type TrainDisplayInput,
    trainDisplay,
} from "@megisholavonat/core/display";
import { MARKER } from "@megisholavonat/core/tokens";
import { useTranslations } from "next-intl";
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

/** "pontos", "+7", "+7?" when stale, or "–" without a delay to show. */
function useDelayLabel(delay: number | null, stale: boolean) {
    const t = useTranslations("Delay");
    if (delay == null) return { onTime: false, text: "–" };
    const onTime = getDelayLevel(delay) === "onTime";
    const text = onTime ? t("on_time") : formatDelay(delay);
    return { onTime, text: stale && !onTime ? `${text}?` : text };
}

/**
 * Delay as coloured text: "pontos" or "+7". Stale delays get a "?"; without
 * a delay (an idle or cancelled train) it is a grey "–".
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
    const level = levelOf(delay ?? 0, stale || delay == null);
    const { text } = useDelayLabel(delay, stale);
    return (
        <span className={cn("tnum font-bold", TEXT_CLASS[level], className)}>
            {text}
        </span>
    );
}

/** Tinted chip for lists and boards: "pontos", "+5", "+74". */
export function DelayChip({
    delay,
    stale = false,
    className,
}: {
    delay: number | null;
    stale?: boolean;
    className?: string;
}) {
    const level = levelOf(delay ?? 0, stale || delay == null);
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
    delay: number | null;
    stale?: boolean;
    size?: "md" | "lg";
}) {
    const level = levelOf(delay ?? 0, stale || delay == null);
    const { onTime, text } = useDelayLabel(delay, stale);
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
                {text}
            </span>
        </div>
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
