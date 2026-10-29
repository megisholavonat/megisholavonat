"use client";

import type { TrainFeatureProperties } from "@megisholavonat/api-client";
import { useTranslations } from "next-intl";
import { TrainDisruptions } from "@/components/disruptions/Disruptions";
import { TrainHistoryLink } from "@/components/stats/HistoryLinks";
import { DelayTile } from "@/components/ui/Delay";
import { PlatformBadge } from "@/components/ui/Platform";
import { destinationOf, trainName } from "@/lib/train";
import {
    BackButton,
    NextStopLine,
    Punctuality,
    ReasonBanner,
    ServiceGlyphs,
    StopList,
    StopListSkeleton,
    TrainActions,
    TrainTitle,
    VehicleDetails,
} from "./TrainParts";
import { useScrollToCurrentStop } from "./TrainSheet";
import { type TrainView, useShownDelay } from "./useTrainView";

/**
 * Desktop train panel, docked top-left over the map (the page positions
 * and animates it). The destination keeps the title row; the train's name
 * goes on its own line.
 */
export function TrainPanel({
    view,
    fallback,
    onClose,
    onFollow,
}: {
    view: TrainView | null;
    fallback: TrainFeatureProperties | null;
    onClose: () => void;
    onFollow: () => void;
}) {
    const t = useTranslations("Train");
    const vehicle = view?.vehicle;
    const next = view?.next;
    const tripShortName =
        vehicle?.trip.tripShortName ?? fallback?.tripShortName ?? "";
    const name = trainName(tripShortName);
    const listRef = useScrollToCurrentStop(view, true);
    const shown = useShownDelay(view, fallback);
    return (
        <section
            aria-label={t("sheet_label")}
            className="floating-card flex h-full w-[400px] max-w-full flex-col overflow-hidden rounded-sheet"
        >
            <div className="flex flex-col gap-3 border-b border-line p-4">
                <div className="flex items-center gap-2">
                    <BackButton onClick={onClose} />
                    <h2 className="flex min-w-0 flex-1 flex-col text-headline">
                        <TrainTitle
                            routeShortName={
                                vehicle?.trip.route.shortName ??
                                fallback?.routeShortName ??
                                ""
                            }
                            tripShortName={tripShortName}
                            destination={
                                vehicle ? destinationOf(vehicle) : null
                            }
                        />
                        {name && (
                            <span className="truncate text-caption font-semibold tracking-wide text-ink-2">
                                {name}
                            </span>
                        )}
                    </h2>
                </div>
                <div className="flex items-center gap-3">
                    <DelayTile delay={shown.delay} stale={shown.stale} />
                    <div className="flex min-w-0 flex-1 flex-col">
                        {next ? (
                            <NextStopLine stop={next} stale={shown.stale} />
                        ) : (
                            <span className="h-5 w-40 animate-pulse rounded-sm bg-surface-2" />
                        )}
                        {view?.usuallyLate && (
                            <span className="text-caption text-delay-slight">
                                {t(
                                    view.usuallyLate === "veryLate"
                                        ? "usually_very_late"
                                        : "usually_late",
                                )}
                            </span>
                        )}
                    </div>
                    {next?.platform && (
                        <PlatformBadge
                            platform={next.platform}
                            predicted={next.platformPredicted}
                            size="lg"
                        />
                    )}
                </div>
                {view && <TrainActions view={view} onFollow={onFollow} />}
                {view?.reason && (
                    <ReasonBanner
                        reason={view.reason}
                        delay={view.display.delay ?? 0}
                        detailed
                    />
                )}
                {/* In the header: the stop list scrolls to the train */}
                {view && <TrainDisruptions view={view} />}
            </div>
            <div
                ref={listRef}
                className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-2"
            >
                {view ? (
                    <>
                        <ServiceGlyphs view={view} />
                        <StopList view={view} />
                        <TrainHistoryLink
                            tripShortName={view.vehicle.trip.tripShortName}
                        />
                        <VehicleDetails view={view} />
                    </>
                ) : (
                    <StopListSkeleton />
                )}
            </div>
            {view?.punctuality && (
                <div className="border-t border-line px-4 py-3">
                    <Punctuality punctuality={view.punctuality} />
                </div>
            )}
        </section>
    );
}
