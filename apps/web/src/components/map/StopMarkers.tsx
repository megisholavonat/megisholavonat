"use client";

import type { ApiResponse } from "@megisholavonat/api-client";
import { useTheme } from "next-themes";
import { Marker } from "react-leaflet";
import { Z_LAYERS } from "@/util/constants";
import { createStopIcon } from "@/util/icon";

type Train = ApiResponse["locations"][number];

interface StopMarkersProps {
    selectedTrain: Train;
    showStationNames: boolean;
    stationNamesOpacity: number;
}

export function StopMarkers({
    selectedTrain,
    showStationNames,
    stationNamesOpacity,
}: StopMarkersProps) {
    const { resolvedTheme } = useTheme();
    const isDarkTheme = resolvedTheme === "dark";

    if (!selectedTrain?.trip?.stoptimes) return null;

    return (
        <>
            {selectedTrain.trip.stoptimes.map((stoptime) => {
                // Determine if this stop has been passed by the train
                const processedStop = selectedTrain.processedStops?.find(
                    (ps) => ps.id === stoptime.stop.name,
                );
                const hasPassed = processedStop
                    ? selectedTrain.trainPosition >
                      processedStop.distanceAlongRoute
                    : false;

                return (
                    <Marker
                        key={stoptime.stop.name}
                        position={[stoptime.stop.lat, stoptime.stop.lon]}
                        icon={createStopIcon(
                            stoptime.stop.name,
                            hasPassed,
                            showStationNames,
                            stationNamesOpacity,
                            isDarkTheme,
                        )}
                        zIndexOffset={Z_LAYERS.STOP_MARKERS}
                        alt={stoptime.stop.name}
                    />
                );
            })}
        </>
    );
}
