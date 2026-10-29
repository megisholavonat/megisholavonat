"use client";

import {
    DELAY_REASONS,
    type DelayReasonCode,
} from "@megisholavonat/core/delayReasons";
import type { Locale } from "@megisholavonat/core/i18n";
import { useLocale, useTranslations } from "next-intl";
import { type Level, TEXT_CLASS } from "@/components/ui/Delay";
import { ReasonIcon } from "@/components/ui/ReasonIcon";
import { cn } from "@/lib/utils";

/** Short reason label in the current language: "Más vonat". */
export function useReasonLabel(): (code: DelayReasonCode) => string {
    const locale = useLocale() as Locale;
    return (code) => DELAY_REASONS[code]?.[locale] ?? code;
}

/**
 * One-line delay reason for list rows: icon + "Késés oka: Más vonat", in the
 * colour of the row's delay. Never a bare label, so it reads as a cause.
 */
export function ReasonLabel({
    code,
    level,
    className,
}: {
    code: DelayReasonCode;
    level: Level;
    className?: string;
}) {
    const t = useTranslations("Delay");
    const label = useReasonLabel()(code);
    return (
        <span
            className={cn(
                "flex min-w-0 items-center gap-1",
                TEXT_CLASS[level],
                className,
            )}
            title={t("reason_plain", { reason: label })}
        >
            <ReasonIcon code={code} className="size-3.5 shrink-0" />
            <span className="truncate">
                {t.rich("reason", {
                    reason: label,
                    b: (chunks) => <b className="font-semibold">{chunks}</b>,
                })}
            </span>
        </span>
    );
}
