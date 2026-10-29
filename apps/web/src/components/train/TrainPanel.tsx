"use client";

import type { TrainFeatureProperties } from "@megisholavonat/api-client";
import { useTranslations } from "next-intl";
import { DelayTile } from "@/components/ui/Delay";
import { PlatformBadge } from "@/components/ui/Platform";
import { destinationOf } from "@/lib/train";
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
import type { TrainView } from "./useTrainView";

/** Desktop train panel, docked top-left over the map. */
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
    return (
        <section
            aria-label={t("sheet_label")}
            className="floating-card absolute top-4 bottom-4 left-4 z-30 flex w-[400px] flex-col overflow-hidden rounded-sheet"
        >
            <div className="flex flex-col gap-3 border-b border-line p-4">
                <div className="flex items-center gap-2">
                    <BackButton onClick={onClose} />
                    <h2 className="min-w-0 flex-1 text-headline">
                        <TrainTitle
                            routeShortName={
                                vehicle?.trip.route.shortName ??
                                fallback?.routeShortName ??
                                ""
                            }
                            tripShortName={
                                vehicle?.trip.tripShortName ??
                                fallback?.tripShortName ??
                                ""
                            }
                            destination={
                                vehicle ? destinationOf(vehicle) : null
                            }
                            withName
                        />
                    </h2>
                </div>
                <div className="flex items-center gap-3">
                    <DelayTile
                        delay={vehicle?.delay ?? fallback?.delay ?? 0}
                        stale={view?.stale ?? !!fallback?.isStale}
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                        {next ? (
                            <NextStopLine
                                stop={next}
                                stale={view?.stale ?? false}
                            />
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
                        delay={view.vehicle.delay}
                        detailed
                    />
                )}
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-2">
                {view ? (
                    <>
                        <ServiceGlyphs view={view} />
                        <StopList view={view} />
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
