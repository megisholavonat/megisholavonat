"use client";

import type { TrainFeature } from "@megisholavonat/api-client";
import { useEffect } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { useIsMobile } from "@/hooks/useIsMobile";

interface MapControllerProps {
    mapRef: React.RefObject<MapRef | null>;
    selectedTrainId?: string | null;
    trains?: { features?: TrainFeature[] };
    isPanelOpen: boolean;
}

export function MapController({
    mapRef,
    selectedTrainId,
    trains,
    isPanelOpen,
}: MapControllerProps) {
    const isMobile = useIsMobile();

    useEffect(() => {
        if (!isMobile || !selectedTrainId || !trains || !isPanelOpen) return;

        const map = mapRef.current;
        if (!map) return;

        const mapContainer = map.getCanvas().parentElement;
        if (!mapContainer) return;

        const mapHeight = mapContainer.offsetHeight;
        const dockHeight = window.innerHeight * 0.6;
        const visibleMapHeight = mapHeight - dockHeight;

        const feature = trains.features?.find(
            (f: TrainFeature) => f.properties.vehicleId === selectedTrainId,
        );

        if (!feature) return;

        const { lon, lat } = feature.properties;
        const point = map.project([lon, lat] as [number, number]);

        if (point.y > visibleMapHeight * 0.8) {
            const targetY = visibleMapHeight * 0.4;
            const offsetY = point.y - targetY;

            const newCenter = map.unproject([
                mapContainer.offsetWidth / 2,
                mapContainer.offsetHeight / 2 + offsetY,
            ] as [number, number]);

            map.easeTo({
                center: newCenter,
                duration: 800,
            });
        }
    }, [mapRef, selectedTrainId, trains, isPanelOpen, isMobile]);

    return null;
}
