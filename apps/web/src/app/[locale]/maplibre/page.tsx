"use client";
import {
    Layer,
    Map as MapLibreMap,
    type MapMouseEvent,
    Popup,
    Source,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useMemo, useState } from "react";
import { MapImage } from "@/components/map/MapImage";
import { useQuery } from "@tanstack/react-query";
import { getTrainsOptions } from "@megisholavonat/api-client/react-query";
import { TrainPanel } from "@/components/information/TrainPanel";
import { AnimatePresence, motion } from "motion/react";
import { Z_LAYERS } from "@/util/constants";

const SVG_TRIANGLE = `
<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
  <path d="M24 4 L32 20 L16 20 Z" fill="white" /> 
</svg>
`;

const desktopVariants = {
    hidden: {
        x: "100%",
        opacity: 0,
    },
    visible: {
        x: 0,
        opacity: 1,
        transition: {
            type: "spring" as const,
            damping: 30,
            stiffness: 300,
            opacity: { duration: 0.3 },
        },
    },
    exit: {
        x: "100%",
        opacity: 0,
        transition: {
            type: "spring" as const,
            damping: 30,
            stiffness: 300,
            opacity: { duration: 0.2 },
        },
    },
};

export default function MaplibrePage() {
    const { data } = useQuery(getTrainsOptions());
    const [cursor, setCursor] = useState<string | null>(null);
    const [hoverInfo, setHoverInfo] = useState<any>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    console.log(data);

    const circleColor = useMemo(
        () => [
            "case",
            ["==", ["get", "id"], selectedId || ""],
            "#00bcd4", // Selected (Cyan)
            ["step", ["get", "delay"], "#4caf50", 5, "#ff9800", 15, "#f44336"], // Default (Delay)
        ],
        [selectedId],
    );

    const typeColor = [
        "match",
        ["get", "type"],
        "IC",
        "#2196f3", // Blue
        "REG",
        "#000000", // Black
        "#9e9e9e", // Gray
    ];

    const onHover = useCallback(
        (e: MapMouseEvent) => {
            const feature = e.features?.[0];
            if (feature && data) {
                setCursor("pointer");
                // Look up the full feature from the original data to get all properties
                console.log(feature);
                setHoverInfo(feature);
            } else {
                setCursor(null);
                setHoverInfo(null);
            }
        },
        [data],
    );

    const onClick = useCallback((e: MapMouseEvent) => {
        const feature = e.features?.[0];
        if (feature) {
            const id = feature.properties.vehicleId;
            setSelectedId((prev) => (prev === id ? null : id));
        } else {
            setSelectedId(null);
        }
    }, []);

    return (
        <>
            <AnimatePresence>
                {selectedId && (
                    <motion.div
                        className="md:w-1/2 lg:w-1/3 rounded-l-3xl bg-white border-l border-gray-300 overflow-hidden flex-col fixed right-0 top-0 h-full shadow-2xl"
                        style={{ zIndex: Z_LAYERS.PANELS }}
                        variants={desktopVariants}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                    >
                        <TrainPanel
                            vehicleId={selectedId}
                            onClose={() => setSelectedId(null)}
                            showCloseButton={true}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
            <MapLibreMap
                initialViewState={{
                    longitude: 19.045,
                    latitude: 47.499,
                    zoom: 13,
                }}
                maxPitch={0}
                dragRotate={false}
                style={{ width: "100vw", height: "100vh" }}
                mapStyle="https://tiles.openfreemap.org/styles/liberty"
                interactiveLayerIds={["marker-main", "marker-heading"]}
                cursor={cursor ?? undefined}
                onClick={onClick}
                onMouseMove={onHover}
            >
                <MapImage id="marker-triangle" svg={SVG_TRIANGLE} sdf={true} />
                <Source
                    id="vehicles-source"
                    type="geojson"
                    data={
                        data ?? {
                            type: "FeatureCollection",
                            features: [],
                        }
                    }
                >
                    <Layer
                        id="marker-heading"
                        type="symbol"
                        layout={{
                            "icon-image": "marker-triangle",
                            "icon-size": 0.7,
                            "icon-rotate": ["get", "heading"],
                            "icon-rotation-alignment": "map",
                            "icon-allow-overlap": true,
                            "icon-ignore-placement": true,
                            "icon-offset": [0, -12], // Push it "forward" (Up)
                        }}
                        paint={{
                            "icon-color": typeColor, // Matches the border color
                        }}
                    />
                    <Layer
                        id="marker-main"
                        type="circle"
                        paint={{
                            "circle-radius": 10,
                            "circle-stroke-width": 3,
                            "circle-color": circleColor,
                            "circle-stroke-color": typeColor,
                        }}
                    />
                </Source>
                {hoverInfo && (
                    <Popup
                        longitude={hoverInfo.geometry.coordinates[0]}
                        latitude={hoverInfo.geometry.coordinates[1]}
                        offset={[0, -10]} // Offset to appear "above" the marker
                        closeButton={false}
                        closeOnClick={false}
                        anchor="bottom"
                    >
                        <div className="text-black text-sm font-bold px-1">
                            {hoverInfo.properties.vehicleId} (
                            {hoverInfo.properties.delay} min)
                        </div>
                    </Popup>
                )}
            </MapLibreMap>
        </>
    );
}
