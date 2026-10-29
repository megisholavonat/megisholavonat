import { DISPLAY_RULES } from "@megisholavonat/core/tokens";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * Platform badge: announced (solid ink), predicted from history ("6?",
 * dashed) or already passed (quiet grey).
 */
export function PlatformBadge({
    platform,
    predicted = false,
    passed = false,
    size = "md",
}: {
    platform: string;
    predicted?: boolean;
    passed?: boolean;
    size?: "md" | "lg";
}) {
    const t = useTranslations("Platform");
    const label = predicted
        ? t("predicted", { platform })
        : t("announced", { platform });
    return (
        <span
            role="img"
            title={label}
            aria-label={label}
            className={cn(
                "tnum inline-flex shrink-0 items-center justify-center rounded-sm font-bold",
                size === "lg"
                    ? "h-10 min-w-10 px-2 text-headline"
                    : "h-7 min-w-7 px-1.5 text-sm",
                predicted
                    ? "border-[1.5px] border-dashed border-ink text-ink"
                    : passed
                      ? "bg-surface-2 text-ink-2"
                      : "bg-action text-on-action",
            )}
        >
            {platform}
            {predicted ? DISPLAY_RULES.predictedPlatform.suffix : ""}
        </span>
    );
}
