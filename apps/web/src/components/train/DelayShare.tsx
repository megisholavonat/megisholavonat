"use client";

import { getRunSummaryOptions } from "@megisholavonat/api-client/react-query";
import {
    type DelaySummary,
    delaySummary,
    recentRun,
    runDate,
} from "@megisholavonat/core/delaySummary";
import type { Locale } from "@megisholavonat/core/i18n";
import { delaySummaryUrl, type RunStops } from "@megisholavonat/core/links";
import { useQuery } from "@tanstack/react-query";
import { Check, Share } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { Follow } from "@/hooks/useFollows";
import { useNow } from "@/hooks/useNow";
import { shareLink } from "@/lib/share";
import { beforeDeparture, trainNumber } from "@/lib/train";
import { cn } from "@/lib/utils";
import type { TrainView } from "./useTrainView";

export interface DelayShareTarget {
    number: string;
    /** The run's date (its departure from the origin), YYYY-MM-DD */
    date: string;
    stops?: RunStops;
}

/**
 * The run's delay card, refreshed while it is on its way; null until it has
 * a delay to tell (or a cancellation), so the action only shows then.
 */
export function useDelaySummary(
    target: DelayShareTarget | null,
): DelaySummary | null {
    const { data } = useQuery({
        ...getRunSummaryOptions({
            path: {
                trainNumber: target?.number ?? "",
                serviceDate: target?.date ?? "",
            },
            query: target?.stops?.from
                ? { from: target.stops.from }
                : undefined,
        }),
        enabled: !!target,
        staleTime: 60_000,
        refetchInterval: (query) =>
            query.state.data?.finished ? false : 120_000,
        retry: false,
    });
    if (!data || !target) return null;
    const card = delaySummary(data, target.stops);
    return card.outcome === "unknown" ? null : card;
}

/**
 * Opens the share sheet with the card link alone, or copies it: no
 * prefilled message, the card's preview (og:image, title and the sentence
 * as description) tells the delay.
 */
function shareCard(
    target: DelayShareTarget,
    locale: Locale,
    title: string,
): Promise<"shared" | "copied" | null> {
    const url = delaySummaryUrl(
        window.location.origin,
        locale,
        target.number,
        target.date,
        target.stops,
    );
    return shareLink({ title, url });
}

/**
 * "Megosztom a késést": the run's delay card as a link.
 * `row` is the full-width row of the train sheet, `icon` the compact
 * button beside a commute row.
 */
export function DelayShareButton({
    target,
    variant = "row",
    arrivedOnly = false,
    className,
}: {
    target: DelayShareTarget | null;
    variant?: "row" | "icon";
    /** Only once the run is over, not the delay so far */
    arrivedOnly?: boolean;
    className?: string;
}) {
    const t = useTranslations("DelayCard");
    const locale = useLocale() as Locale;
    const card = useDelaySummary(target);
    const [copied, setCopied] = useState(false);
    if (!card || !target || (arrivedOnly && card.soFar)) return null;
    const label = copied
        ? t("copied")
        : card.soFar
          ? t("share_so_far")
          : t("share");
    const onClick = async () => {
        if ((await shareCard(target, locale, t("title"))) === "copied") {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };
    const Icon = copied ? Check : Share;
    if (variant === "icon") {
        return (
            <button
                type="button"
                onClick={onClick}
                aria-label={label}
                title={label}
                className={cn(
                    "pressable flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink",
                    className,
                )}
            >
                <Icon className="size-5" aria-hidden />
            </button>
        );
    }
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "pressable flex min-h-11 cursor-pointer items-center gap-2 rounded-md bg-surface-2 px-3 text-left text-subhead font-semibold text-ink hover:bg-line",
                className,
            )}
        >
            <Icon className="size-4" aria-hidden />
            <span className="flex-1">{label}</span>
        </button>
    );
}

/** The train sheet's run, once it has left (or is cancelled). */
export function TrainDelayShare({ view }: { view: TrainView }) {
    const now = useNow();
    const { vehicle, display } = view;
    const waiting =
        display.activity === "beforeDeparture" ||
        (display.activity == null && beforeDeparture(vehicle, new Date(now)));
    const number = trainNumber(vehicle.trip.tripShortName);
    const date = runDate(vehicle.trip, new Date(now));
    return (
        <DelayShareButton
            target={waiting || !number ? null : { number, date }}
        />
    );
}

/**
 * Beside a commute row: the followed train's latest run, once it is over
 * ("Megosztom a késést"). The date is the boarding day; the API finds a
 * run that left its origin the evening before by the boarding station.
 */
export function CommuteDelayShare({ follow }: { follow: Follow }) {
    const now = useNow();
    const run = recentRun(follow, new Date(now));
    return (
        <DelayShareButton
            variant="icon"
            arrivedOnly
            target={
                run
                    ? {
                          number: follow.trainNumber,
                          date: run.date,
                          stops: { from: follow.fromStationId },
                      }
                    : null
            }
        />
    );
}
