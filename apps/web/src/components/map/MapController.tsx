import type { VehiclePositionWithDelay } from "@megisholavonat/api-client";
import { useEffect } from "react";
import { useMap } from "react-leaflet";
import type { SearchSelection } from "@/app/[locale]/page";
import { useIsMobile } from "@/hooks/useIsMobile";

interface MapControllerProps {
    selectedTrain?: VehiclePositionWithDelay;
    searchSelection?: SearchSelection;
    isPanelOpen: boolean;
}

export function MapController({
    selectedTrain,
    searchSelection,
    isPanelOpen,
}: MapControllerProps) {
    const map = useMap();
    const isMobile = useIsMobile();

    useEffect(() => {
        // Focus on train when selected via search
        if (searchSelection && selectedTrain) {
            const currentZoom = map.getZoom();
            const targetZoom = Math.max(currentZoom, 10);

            map.setView([selectedTrain.lat, selectedTrain.lon], targetZoom, {
                animate: true,
                duration: 1.2,
            });
        }
    }, [map, searchSelection, selectedTrain]);

    useEffect(() => {
        // Move map up on mobile when panel opens if train would be hidden
        if (isMobile && selectedTrain && isPanelOpen) {
            const mapContainer = map.getContainer();
            const mapHeight = mapContainer.offsetHeight;

            // Estimate dock height (60% of viewport height in normal state)
            const dockHeight = window.innerHeight * 0.6;
            const visibleMapHeight = mapHeight - dockHeight;

            // Get train's pixel position on map
            const trainLatLng = [selectedTrain.lat, selectedTrain.lon] as [
                number,
                number,
            ];
            const trainPoint = map.latLngToContainerPoint(trainLatLng);

            // If train would be hidden by the dock, center it in the visible area
            if (trainPoint.y > visibleMapHeight * 0.8) {
                // Position train at 40% from top of visible area
                const targetY = visibleMapHeight * 0.4;
                const offsetY = trainPoint.y - targetY;

                // Calculate new center by moving up by the offset
                const newCenterPoint: [number, number] = [
                    mapContainer.offsetWidth / 2,
                    mapContainer.offsetHeight / 2 + offsetY,
                ];
                const newCenter = map.containerPointToLatLng(newCenterPoint);

                map.setView(newCenter, map.getZoom(), {
                    animate: true,
                    duration: 0.8,
                });
            }
        }
    }, [map, selectedTrain, isPanelOpen, isMobile]);

    return null;
}
