"use client";

import { useTheme } from "next-themes";
import { useEffect } from "react";
import { TileLayer, useMap } from "react-leaflet";
import { BASE_MAPS, type BaseMapKey, OVERLAYS } from "@/util/mapConfigs";

interface MapLayersProps {
    baseMap: BaseMapKey;
    showRailwayOverlay: boolean;
    theme: string | undefined
}

export function MapLayers({ baseMap, showRailwayOverlay, theme }: MapLayersProps) {
    const map = useMap();
    const mapConfig = BASE_MAPS[baseMap];

    const tilePane = map.getPane("tilePane");

    if (tilePane) {
        if (theme === "dark") {
            tilePane.style.filter = "invert(100%) hue-rotate(180deg) brightness(0.8) contrast(1.1) saturate(0.6)";
        } else {
            tilePane.style.filter = "";
        }
    }

    return (
        <>
            {/* Base map layer */}
            <TileLayer
                key={`${baseMap}-${theme ? "dark" : "light"}`}
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
