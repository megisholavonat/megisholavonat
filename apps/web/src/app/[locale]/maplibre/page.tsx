"use client";
import {
    Layer,
    Map as MapLibreMap,
    type MapMouseEvent,
    Popup,
    Source,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import {
    getTrainDetailsOptions,
    getTrainsOptions,
} from "@megisholavonat/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useMemo, useState } from "react";
import { TrainPanel } from "@/components/information/TrainPanel";
import { MapImage } from "@/components/map/MapImage";
import { Z_LAYERS } from "@/util/constants";
import polyline from "@mapbox/polyline";
import { TrainTooltip } from "@/components/map/TrainTooltip";
import { TrainFeatureProperties } from "@megisholavonat/api-client";

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
    const { data: trains } = useQuery(getTrainsOptions());
    const [cursor, setCursor] = useState<string | null>(null);
    const [hoverInfo, setHoverInfo] = useState<TrainFeatureProperties | null>(
        null,
    );
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const { data: train } = useQuery({
        ...getTrainDetailsOptions({ path: { vehicle_id: selectedId ?? "" } }),
        enabled: !!selectedId,
    });

    const polylineGeojson = useMemo(() => {
        if (!train?.trip.tripGeometry) return null;

        return {
            type: "Feature",
            properties: {},
            geometry: polyline.toGeoJSON(train.trip.tripGeometry.points),
        };
    }, [train]);

    const circleColor = useMemo(
        () => [
            "case",
            ["==", ["get", "vehicleId"], selectedId || ""],
            "#00bcd4", // Selected (Cyan)
            [
                "step",
                ["get", "delay"],
                "#4AD94A",
                5,
                "#E4DE3A",
                15,
                "#DF9227",
                60,
                "#D9564A",
            ], // Default (Delay)
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
            if (feature && trains) {
                setCursor("pointer");

                setHoverInfo(feature.properties as TrainFeatureProperties);
            } else {
                setCursor(null);
                setHoverInfo(null);
            }
        },
        [trains],
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
                {train && (
                    <motion.div
                        className="md:w-1/2 lg:w-1/3 rounded-l-3xl bg-white border-l border-gray-300 overflow-hidden flex-col fixed right-0 top-0 h-full shadow-2xl"
                        style={{ zIndex: Z_LAYERS.PANELS }}
                        variants={desktopVariants}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                    >
                        <TrainPanel
                            vehicle={train}
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
                        trains ?? {
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
                {polylineGeojson && (
                    <Source
                        id="polyline-source"
                        type="geojson"
                        data={polylineGeojson}
                    >
                        <Layer
                            id="polyline-layer"
                            type="line"
                            paint={{ "line-color": "#0066ff", "line-width": 4 }}
                            layout={{
                                "line-cap": "round",
                                "line-join": "round",
                            }}
                        />
                    </Source>
                )}
                {hoverInfo && (
                    <Popup
                        longitude={hoverInfo.lon}
                        latitude={hoverInfo.lat}
                        offset={[0, -10]} // Offset to appear "above" the marker
                        closeButton={false}
                        closeOnClick={false}
                        anchor="bottom"
                        className="vehicle-tooltip"
                    >
                        <TrainTooltip featureProperties={hoverInfo} />
                    </Popup>
                )}
            </MapLibreMap>
        </>
    );
}
