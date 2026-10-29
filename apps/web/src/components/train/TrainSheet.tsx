"use client";

import type { TrainFeatureProperties } from "@megisholavonat/api-client";
import { getDelayLevel } from "@megisholavonat/core/delay";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { TrainDisruptions } from "@/components/disruptions/Disruptions";
import { type Detent, SheetClose } from "@/components/sheet/BottomSheet";
import { TrainHistoryLink } from "@/components/stats/HistoryLinks";
import {
    formatDelay,
    levelOf,
    RollingText,
    TEXT_CLASS,
} from "@/components/ui/Delay";
import { PlatformBadge } from "@/components/ui/Platform";
import { destinationOf } from "@/lib/train";
import { cn } from "@/lib/utils";
import {
    Punctuality,
    ReasonBanner,
    ServiceGlyphs,
    StopList,
    StopListSkeleton,
    TrainActions,
    TrainSummary,
    TrainTitle,
    VehicleDetails,
} from "./TrainParts";
import type { TrainView } from "./useTrainView";

/**
 * Scrolls the full stop list so the stop the train stands at, or the one
 * before it, sits at the top, once per train (the half sheet already starts
 * at the current stop). Near the first stop the list stays at its top, so
 * the rows above the stops are never cut in half.
 */
export function useScrollToCurrentStop(
    view: TrainView | null,
    enabled: boolean,
) {
    const ref = useRef<HTMLDivElement>(null);
    const done = useRef<string | null>(null);
    const target = view?.next ? (view.standingAt ?? view.next.index - 1) : null;
    const key = view ? `${view.vehicle.vehicleId}` : null;
    useEffect(() => {
        if (!enabled || !key || target == null) {
            if (!enabled) done.current = null;
            return;
        }
        if (done.current === key) return;
        const root = ref.current;
        const scroller = root?.closest<HTMLElement>(".overflow-y-auto");
        // Rows before the train's position line up with the stops
        const row = root?.querySelector("ol")?.children[Math.max(0, target)] as
            | HTMLElement
            | undefined;
        if (!row || !scroller) return;
        done.current = key;
        if (target <= 0) {
            scroller.scrollTop = 0;
            return;
        }
        const offset =
            row.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top;
        scroller.scrollTop += offset - 8;
    }, [enabled, key, target]);
    return ref;
}

/**
 * The full header's delay: signed minutes like the tile ("+3", "0", "−2"),
 * with the tile's small "pontos" / "korán" caption under an on-time number.
 */
function HeaderDelay({
    delay,
    stale,
}: {
    /** Null for an idle or cancelled train: a grey "–", like the tile */
    delay: number | null;
    stale: boolean;
}) {
    const t = useTranslations("Delay");
    const none = delay == null;
    const minutes = Math.round(delay ?? 0);
    const caption =
        none || stale || getDelayLevel(minutes) !== "onTime"
            ? null
            : minutes < 0
              ? t("early")
              : t("on_time");
    const label = none ? "–" : `${formatDelay(minutes)}${stale ? "?" : ""}`;
    return (
        <span
            role="img"
            aria-label={t("tile_label", { delay: label })}
            className={cn(
                "flex shrink-0 flex-col items-end leading-none",
                TEXT_CLASS[levelOf(minutes, stale || none)],
            )}
        >
            <RollingText
                value={label}
                order={minutes}
                className="tnum text-headline leading-none font-extrabold"
            />
            {caption && (
                <span className="mt-0.5 text-[11px] leading-[13px] font-semibold">
                    {caption}
                </span>
            )}
        </span>
    );
}

/**
 * Mobile train sheet header. Peek and half: the summary row (with the
 * platform at peek); full: the title and the actions, which stay pinned
 * while the stops scroll. The close button sits beside the handle at every
 * detent, so the summary keeps the whole width.
 */
export function TrainSheetHeader({
    view,
    fallback,
    detent,
    onClose,
    onFollow,
}: {
    view: TrainView | null;
    fallback: TrainFeatureProperties | null;
    detent: Detent;
    onClose: () => void;
    onFollow: () => void;
}) {
    const next = view?.next;
    return (
        <>
            <SheetClose onClick={onClose} />
            {detent === "full" && view ? (
                <div className="flex flex-col gap-3 px-4 pb-3">
                    <div className="flex items-center gap-3 pr-8">
                        <TrainTitle
                            routeShortName={view.vehicle.trip.route.shortName}
                            tripShortName={view.vehicle.trip.tripShortName}
                            destination={destinationOf(view.vehicle)}
                            className="flex-1 text-headline"
                        />
                        <HeaderDelay
                            delay={view.display.delay}
                            stale={view.stale}
                        />
                    </div>
                    <TrainActions view={view} onFollow={onFollow} />
                </div>
            ) : (
                <TrainSummary
                    view={view}
                    fallback={fallback}
                    trailing={
                        detent === "peek" && next?.platform ? (
                            // Smaller on narrow phones, so the destination fits
                            <>
                                <span className="contents max-[379px]:hidden">
                                    <PlatformBadge
                                        platform={next.platform}
                                        predicted={next.platformPredicted}
                                        size="lg"
                                    />
                                </span>
                                <span className="contents min-[380px]:hidden">
                                    <PlatformBadge
                                        platform={next.platform}
                                        predicted={next.platformPredicted}
                                    />
                                </span>
                            </>
                        ) : null
                    }
                />
            )}
        </>
    );
}

/** Mobile train sheet body. */
export function TrainSheetBody({
    view,
    detent,
    onFollow,
}: {
    view: TrainView | null;
    detent: Detent;
    onFollow: () => void;
}) {
    const listRef = useScrollToCurrentStop(view, detent === "full");
    return (
        <div ref={listRef} className="flex flex-col gap-3 px-4 pb-6">
            {!view ? (
                <StopListSkeleton />
            ) : detent === "full" ? (
                <>
                    {view.reason && (
                        <ReasonBanner
                            reason={view.reason}
                            delay={view.display.delay ?? 0}
                            detailed
                        />
                    )}
                    <TrainDisruptions view={view} />
                    {view.punctuality && (
                        <Punctuality punctuality={view.punctuality} />
                    )}
                    <ServiceGlyphs view={view} />
                    <StopList view={view} />
                    <TrainHistoryLink
                        tripShortName={view.vehicle.trip.tripShortName}
                    />
                    <VehicleDetails view={view} />
                </>
            ) : (
                <>
                    <TrainActions view={view} onFollow={onFollow} />
                    {view.reason && (
                        <ReasonBanner
                            reason={view.reason}
                            delay={view.display.delay ?? 0}
                        />
                    )}
                    <TrainDisruptions view={view} />
                    <StopList view={view} upcomingOnly />
                </>
            )}
        </div>
    );
}
