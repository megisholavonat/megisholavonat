"use client";

import type { TrainFeatureProperties } from "@megisholavonat/api-client";
import { useEffect, useRef } from "react";
import { type Detent, SheetClose } from "@/components/sheet/BottomSheet";
import { TrainHistoryLink } from "@/components/stats/HistoryLinks";
import { DelayText } from "@/components/ui/Delay";
import { PlatformBadge } from "@/components/ui/Platform";
import { destinationOf } from "@/lib/train";
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
 * Scrolls the full stop list so the stop before the train sits at the top,
 * once per train (the half sheet already starts at the current stop).
 */
export function useScrollToCurrentStop(
    view: TrainView | null,
    enabled: boolean,
) {
    const ref = useRef<HTMLDivElement>(null);
    const done = useRef<string | null>(null);
    const nextIndex = view?.next?.index ?? -1;
    const key = view ? `${view.vehicle.vehicleId}` : null;
    useEffect(() => {
        if (!enabled || !key || nextIndex < 0) {
            if (!enabled) done.current = null;
            return;
        }
        if (done.current === key) return;
        const root = ref.current;
        const row = root?.querySelector("ol")?.children[
            Math.max(0, nextIndex - 1)
        ] as HTMLElement | undefined;
        const scroller = root?.closest<HTMLElement>(".overflow-y-auto");
        if (!row || !scroller) return;
        done.current = key;
        const offset =
            row.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top;
        scroller.scrollTop += offset - 8;
    }, [enabled, key, nextIndex]);
    return ref;
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
                        <DelayText
                            delay={view.vehicle.delay}
                            stale={view.stale}
                            className="shrink-0 text-headline"
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
                            delay={view.vehicle.delay}
                            detailed
                        />
                    )}
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
                            delay={view.vehicle.delay}
                        />
                    )}
                    <StopList view={view} upcomingOnly />
                </>
            )}
        </div>
    );
}
