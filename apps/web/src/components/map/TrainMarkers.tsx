"use client";

import type { ApiResponse } from "@megisholavonat/api-client";
import { useTheme } from "next-themes";
import { Marker } from "react-leaflet";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Z_LAYERS } from "@/util/constants";
import { createTrainIcon, getDelayColor } from "@/util/icon";
import {
    dataAppearsFalsified,
    isActive,
    isStale,
    vehicleType,
} from "@/util/vehicle";
import { TrainTooltip } from "./TrainTooltip";

type Train = ApiResponse["locations"][number];

interface TrainMarkersProps {
    trains: Train[];
    selectedVehicleId: string | null;
    onTrainClick: (vehicleId: string) => void;
    showTooltip: boolean;
}

export function TrainMarkers({
    trains,
    selectedVehicleId,
    onTrainClick,
    showTooltip,
}: TrainMarkersProps) {
    const isMobile = useIsMobile();
    const { resolvedTheme } = useTheme();
    const isDarkTheme = resolvedTheme === "dark";
    return (
        <>
            {trains.map((train) => {
                const isSelected = selectedVehicleId === train.vehicleId;
                const zIndex = isSelected
                    ? Z_LAYERS.TRAIN_MARKERS_SELECTED
                    : Z_LAYERS.TRAIN_MARKERS_DEFAULT;
                const active = isActive(train);
                const stale = isStale(train);
                const isFalsified =
                    active && dataAppearsFalsified(train, stale);
                const type = vehicleType(train);
                const color = getDelayColor(train.delay, active, stale);
                const markerIcon = createTrainIcon(
                    train.heading,
                    color,
                    isSelected,
                    isFalsified,
                    type,
                    isDarkTheme,
                );

                return (
                    <Marker
                        key={train.vehicleId}
                        position={[train.lat, train.lon]}
                        icon={markerIcon}
                        zIndexOffset={zIndex}
                        alt={`${type} ${train?.trainNumber ?? train?.vehicleId}`}
                        eventHandlers={{
                            click: () => {
                                onTrainClick(train.vehicleId);
                            },
                        }}
                    >
                        {/* Only show tooltip on desktop, not mobile */}
                        {showTooltip && !isMobile && (
                            <TrainTooltip
                                train={train}
                                showTooltip={showTooltip}
                            />
                        )}
                    </Marker>
                );
            })}
        </>
    );
}
