"use client";

import { useEffect } from "react";
import { MapRef } from "react-map-gl/maplibre";
import { useIsMobile } from "@/hooks/useIsMobile";

interface MapControllerMapLibreProps {
    mapRef: React.RefObject<MapRef>;
    selectedTrainId?: string | null;
    trains?: any; // Using any for now to avoid complex types, will refine
    isPanelOpen: boolean;
}

export function MapControllerMapLibre({
    mapRef,
    selectedTrainId,
    trains,
    isPanelOpen,
}: MapControllerMapLibreProps) {
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
            (f: any) => f.properties.vehicleId === selectedTrainId,
        );

        if (!feature) return;

        const { lon, lat } = feature.properties;
        const trainLatLng = [lon, lat];

        // MapLibre doesn't have a direct latLngToContainerPoint like Leaflet in the same way
        // We can use the map instance to project the coordinate
        const point = map.project(trainLatLng);

        if (point.y > visibleMapHeight * 0.8) {
            const targetY = visibleMapHeight * 0.4;
            const offsetY = point.y - targetY;

            const centerPoint = [
                mapContainer.offsetWidth / 2,
                mapContainer.offsetHeight / 2 + offsetY,
            ];
            const newCenter = map.unproject(centerPoint);

            map.easeTo({
                center: newCenter,
                duration: 800,
            });
        }
    }, [mapRef, selectedTrainId, trains, isPanelOpen, isMobile]);

    return null;
}
