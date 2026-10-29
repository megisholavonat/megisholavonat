"use client";

import { formatSecondsAsTime } from "@megisholavonat/core/time";
import { Star } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { CommuteDelayShare } from "@/components/train/DelayShare";
import { DelayChip, levelOf } from "@/components/ui/Delay";
import { PlatformBadge } from "@/components/ui/Platform";
import { ReasonLabel } from "@/components/ui/Reason";
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
    if (!occ || occ.daysAhead <= 0) return null;
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
        // The same chip as the search, board and late rows
        return <DelayChip delay={live.delay} stale={live.stale} />;
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
    const tTrain = useTranslations("Train");
    const { follow, live, platform } = row;
    // The cause only next to a live delay that is actually late
    const level = levelOf(live?.delay ?? 0, live?.stale);
    const reason =
        live?.reason &&
        !live.canceled &&
        live.delay != null &&
        levelOf(live.delay) !== "onTime"
            ? live.reason
            : null;
    // A live delay that is late moves the departure; within the on-time
    // band, stale or cancelled, the timetable's time stands
    const late =
        live &&
        !live.canceled &&
        !live.stale &&
        live.delay != null &&
        levelOf(live.delay) !== "onTime"
            ? live.delay
            : null;
    return (
        <button
            type="button"
            data-focus-key={`follow:${row.follow.id}`}
            onClick={() => onOpen(row)}
            className={cn(
                "flex w-full min-w-0 cursor-pointer items-center gap-3 text-left",
                compact
                    ? "min-h-11 rounded-md px-2 py-1.5 hover:bg-surface-2"
                    : "min-h-13 py-2",
            )}
        >
            <RouteGlyph
                routeShortName={follow.routeShortName}
                className="text-lg"
            />
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px] font-semibold text-ink">
                    {follow.fromName}{" "}
                    {/* The departure from the boarding stop, which the
                        sheet tells by its arrival: say which it is */}
                    <span className="text-caption font-normal text-ink-2">
                        {tTrain("departs_at")}
                    </span>{" "}
                    {late ? (
                        // Late: when it now leaves, as the board shows it
                        <>
                            <span className="tnum">
                                {formatSecondsAsTime(
                                    follow.departureS + late * 60,
                                )}
                            </span>{" "}
                            <s className="tnum text-caption font-normal text-ink-2">
                                {formatSecondsAsTime(follow.departureS)}
                            </s>
                        </>
                    ) : (
                        <span className="tnum">
                            {formatSecondsAsTime(follow.departureS)}
                        </span>
                    )}
                </span>
                <span className="tnum truncate text-caption text-ink-2">
                    {follow.destination
                        ? `${follow.trainNumber} → ${follow.destination}`
                        : follow.trainNumber}
                </span>
                {reason && (
                    <ReasonLabel
                        code={reason}
                        level={level}
                        className="text-caption"
                    />
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
                <div
                    key={row.follow.id}
                    className={cn(
                        "flex items-center gap-1",
                        !compact && "border-b border-line last:border-b-0",
                    )}
                >
                    <Row
                        row={row}
                        compact={compact}
                        onOpen={(r) =>
                            r.live?.vehicleId
                                ? onOpenTrain(r.live.vehicleId)
                                : onEdit(r.follow)
                        }
                    />
                    <CommuteDelayShare follow={row.follow} />
                </div>
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
