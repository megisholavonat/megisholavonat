"use client";

import { ChartColumn, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { trainNumber } from "@/lib/train";
import { cn } from "@/lib/utils";

/** "Pontosság ›" row of the train sheet, to the train's history. */
export function TrainHistoryLink({ tripShortName }: { tripShortName: string }) {
    const t = useTranslations("Train");
    const number = trainNumber(tripShortName);
    if (!number) return null;
    return (
        <Link
            href={`/stats/train/${encodeURIComponent(number)}`}
            className="flex min-h-11 items-center gap-2 rounded-md bg-surface-2 px-3 text-[15px] font-semibold text-ink"
        >
            <ChartColumn className="size-4" aria-hidden />
            <span className="flex-1">{t("history")}</span>
            <ChevronRight className="size-4 text-ink-2" aria-hidden />
        </Link>
    );
}

/** Icon button of the station board header, to the station's history. */
export function StationHistoryLink({
    stationId,
    className,
}: {
    stationId: string;
    className?: string;
}) {
    const t = useTranslations("Station");
    return (
        <Link
            href={`/stats/station/${encodeURIComponent(stationId)}`}
            aria-label={t("history")}
            title={t("history")}
            className={cn(
                "flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink transition-colors hover:bg-line",
                className,
            )}
        >
            <ChartColumn className="size-5" aria-hidden />
        </Link>
    );
}
