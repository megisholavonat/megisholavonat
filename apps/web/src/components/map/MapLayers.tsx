"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { TileLayer, useMapEvents } from "react-leaflet";
import { BASE_MAPS, type BaseMapKey, OVERLAYS } from "@/util/mapConfigs";
import { LatLng, LatLngBounds } from "leaflet";

interface MapLayersProps {
    baseMap: BaseMapKey;
    showRailwayOverlay: boolean;
}

export function MapLayers({ baseMap, showRailwayOverlay }: MapLayersProps) {
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";
    
    // bounce back to center when the view is outside of the bounds
    const viewsMaxBounds = new LatLngBounds(  
        [48.5833, 16.0833],
        [45.8000, 22.9667],
    );
    const center = useRef<LatLng>(null);
    const map = useMapEvents({
        moveend: () => {
            if (!map.getBounds().intersects(viewsMaxBounds) && center.current) {
                map.panTo(center.current);
            }
        },
    });

    const mapConfig = BASE_MAPS[baseMap];

    // Martin said we have to make our own dark mode map
    useEffect(() => {
        center.current = map.getCenter();

        const tilePane = map.getPane("tilePane");

        if (tilePane) {
            if (isDark) {
                tilePane.style.filter =
                    "invert(100%) hue-rotate(180deg) brightness(0.8) contrast(1.1) saturate(0.6)";
            } else {
                tilePane.style.filter = "";
            }
        }
    }, [isDark, map]);

    return (
        <>
            {/* Base map layer */}
            <TileLayer
                key={`${baseMap}-${isDark ? "dark" : "light"}`}
                attribution={mapConfig.attribution}
                url={mapConfig.url}
                zIndex={1}
            />
            {/* Railway overlay layer */}
            {showRailwayOverlay && (
                <TileLayer
                    attribution={OVERLAYS.railway.attribution}
                    url={OVERLAYS.railway.url}
                    zIndex={2}
                />
            )}
        </>
    );
}
