"use client";

import { DELAY_REASONS } from "@megisholavonat/core/delayReasons";
import type { Locale } from "@megisholavonat/core/i18n";
import { formatSecondsAsTime } from "@megisholavonat/core/time";
import { Star } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { DelayText, levelOf, TEXT_CLASS } from "@/components/ui/Delay";
import { PlatformBadge } from "@/components/ui/Platform";
import { ReasonIcon } from "@/components/ui/ReasonIcon";
import { RouteGlyph } from "@/components/ui/RouteGlyph";
import type { Follow } from "@/hooks/useFollows";
import { cn } from "@/lib/utils";
import type { CommuteRow } from "./useCommute";

/** "holnap", "hétfő" or nothing for today. */
function dayLabel(
    row: CommuteRow,
    locale: string,
    tomorrow: string,
): string | null {
    const occ = row.occurrence;
    if (!occ || occ.daysAhead === 0) return null;
    if (occ.daysAhead === 1) return tomorrow;
    return new Intl.DateTimeFormat(locale, {
        weekday: "long",
        timeZone: "Europe/Budapest",
    }).format(new Date(occ.departure * 1000));
}

/** Right-hand status: live delay, cancelled, or day + "usually late". */
function Status({ row }: { row: CommuteRow }) {
    const t = useTranslations("Follow");
    const tStation = useTranslations("Station");
    const locale = useLocale();
    const { live } = row;
    if (live?.canceled) {
        return (
            <span className="text-[15px] font-bold text-delay-severe">
                {tStation("canceled")}
            </span>
        );
    }
    if (live && live.delay !== null) {
        return (
            <DelayText
                delay={live.delay}
                stale={live.stale}
                className="text-[15px]"
            />
        );
    }
    const day = dayLabel(row, locale, t("tomorrow"));
    const usually = row.usuallyLate
        ? t(
              row.usuallyLate === "veryLate"
                  ? "usually_very_late"
                  : "usually_late",
          )
        : null;
    if (!day && !usually) return null;
    return (
        <span className="text-right text-caption text-ink-2">
            {day}
            {day && usually ? " · " : ""}
            {usually && <span className="text-delay-slight">{usually}</span>}
        </span>
    );
}

function Row({
    row,
    onOpen,
    compact,
}: {
    row: CommuteRow;
    onOpen: (row: CommuteRow) => void;
    compact: boolean;
}) {
    const locale = useLocale() as Locale;
    const { follow, live, platform } = row;
    const reason =
        live?.reason && !live.canceled
            ? DELAY_REASONS[live.reason]?.[locale]
            : null;
    const level = levelOf(Math.max(live?.delay ?? 0, 5));
    return (
        <button
            type="button"
            onClick={() => onOpen(row)}
            className={cn(
                "flex w-full cursor-pointer items-center gap-3 text-left",
                compact
                    ? "min-h-11 rounded-md px-2 py-1.5 hover:bg-surface-2"
                    : "min-h-13 border-b border-line py-2 last:border-b-0",
            )}
        >
            <RouteGlyph
                routeShortName={follow.routeShortName}
                className="text-lg"
            />
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px] font-semibold text-ink">
                    {follow.fromName}{" "}
                    <span className="tnum">
                        {formatSecondsAsTime(follow.departureS)}
                    </span>
                </span>
                {reason && (
                    <span
                        className={cn(
                            "flex min-w-0 items-center gap-1 text-caption",
                            TEXT_CLASS[level],
                        )}
                    >
                        <ReasonIcon
                            code={live?.reason ?? null}
                            className="size-3.5 shrink-0"
                        />
                        <span className="truncate">{reason}</span>
                    </span>
                )}
            </span>
            {platform && (
                <PlatformBadge
                    platform={platform.value}
                    predicted={platform.predicted}
                />
            )}
            <Status row={row} />
        </button>
    );
}

/**
 * "Ingázásom": the next run of each followed train. Rows open the live
 * train, or the follow settings when it is not running.
 */
export function CommuteList({
    rows,
    onOpenTrain,
    onEdit,
    compact = false,
}: {
    rows: CommuteRow[];
    onOpenTrain: (vehicleId: string) => void;
    onEdit: (follow: Follow) => void;
    /** Desktop card: tighter rows with hover */
    compact?: boolean;
}) {
    const t = useTranslations("Follow");
    const visible = rows.filter((row) => row.occurrence);
    if (visible.length === 0) return null;
    return (
        <section aria-label={t("my_commute")} className="flex flex-col">
            {visible.map((row) => (
                <Row
                    key={row.follow.id}
                    row={row}
                    compact={compact}
                    onOpen={(r) =>
                        r.live?.vehicleId
                            ? onOpenTrain(r.live.vehicleId)
                            : onEdit(r.follow)
                    }
                />
            ))}
        </section>
    );
}

/** Empty home: one quiet call to action. */
export function FollowHint({ onClick }: { onClick: () => void }) {
    const t = useTranslations("Follow");
    return (
        <button
            type="button"
            onClick={onClick}
            className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-surface-2 text-[15px] font-semibold text-ink"
        >
            <Star className="size-4.5" aria-hidden />
            {t("follow_your_train")}
        </button>
    );
}
