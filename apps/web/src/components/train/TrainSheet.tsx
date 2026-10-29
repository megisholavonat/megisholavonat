"use client";

import type { TrainFeatureProperties } from "@megisholavonat/api-client";
import { useTranslations } from "next-intl";
import { BottomSheet, type Detent } from "@/components/sheet/BottomSheet";
import { TrainHistoryLink } from "@/components/stats/HistoryLinks";
import { DelayText } from "@/components/ui/Delay";
import { PlatformBadge } from "@/components/ui/Platform";
import { destinationOf } from "@/lib/train";
import {
    CloseButton,
    FollowIconButton,
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

/** Mobile web train sheet: peek · half · full; the whole header drags. */
export function TrainSheet({
    view,
    fallback,
    detent,
    onDetentChange,
    onClose,
    onFollow,
}: {
    view: TrainView | null;
    fallback: TrainFeatureProperties | null;
    detent: Detent;
    onDetentChange: (detent: Detent) => void;
    onClose: () => void;
    onFollow: () => void;
}) {
    const t = useTranslations("Train");
    const next = view?.next;

    const header =
        detent === "full" && view ? (
            <div className="flex items-center gap-2 px-4 pb-3">
                <TrainTitle
                    routeShortName={view.vehicle.trip.route.shortName}
                    tripShortName={view.vehicle.trip.tripShortName}
                    destination={destinationOf(view.vehicle)}
                    className="flex-1 text-headline"
                />
                <DelayText
                    delay={view.vehicle.delay}
                    stale={view.stale}
                    className="text-headline"
                />
                <FollowIconButton view={view} onFollow={onFollow} />
                <CloseButton onClick={onClose} />
            </div>
        ) : (
            <TrainSummary
                view={view}
                fallback={fallback}
                trailing={
                    detent === "peek" ? (
                        next?.platform ? (
                            <PlatformBadge
                                platform={next.platform}
                                predicted={next.platformPredicted}
                                size="lg"
                            />
                        ) : null
                    ) : (
                        <CloseButton onClick={onClose} />
                    )
                }
            />
        );

    return (
        <BottomSheet
            label={t("sheet_label")}
            detent={detent}
            onDetentChange={onDetentChange}
            onDismiss={onClose}
            header={header}
        >
            <div className="flex flex-col gap-3 px-4 pb-6">
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
        </BottomSheet>
    );
}
