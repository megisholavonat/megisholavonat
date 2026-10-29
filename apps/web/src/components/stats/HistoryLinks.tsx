"use client";

import type { Locale } from "@megisholavonat/core/i18n";
import { stationHref, trainPath } from "@megisholavonat/core/links";
import { ChartColumn, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { buttonClass } from "@/components/ui/Button";
import { trainNumber } from "@/lib/train";

/** "Pontosság ›" row of the train sheet, to the train's page. */
export function TrainHistoryLink({ tripShortName }: { tripShortName: string }) {
    const t = useTranslations("Train");
    const locale = useLocale() as Locale;
    const number = trainNumber(tripShortName);
    if (!number) return null;
    return (
        <Link
            href={trainPath(locale, number)}
            className="flex min-h-11 items-center gap-2 rounded-md bg-surface-2 px-3 text-subhead font-semibold text-ink"
        >
            <ChartColumn className="size-4" aria-hidden />
            <span className="flex-1">{t("history")}</span>
            <ChevronRight className="size-4 text-ink-2" aria-hidden />
        </Link>
    );
}

/** Icon button of the station board header, to the station's page. */
export function StationHistoryLink({
    station,
    className,
}: {
    station: { id: string; name: string };
    className?: string;
}) {
    const t = useTranslations("Station");
    const locale = useLocale() as Locale;
    return (
        <Link
            href={stationHref(locale, station)}
            aria-label={t("history")}
            title={t("history")}
            className={buttonClass("icon", className)}
        >
            <ChartColumn className="size-5" aria-hidden />
        </Link>
    );
}
