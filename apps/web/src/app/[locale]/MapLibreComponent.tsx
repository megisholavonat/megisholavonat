"use client";
import {
    Layer,
    Map as MapLibreMap,
    type MapMouseEvent,
    type MapRef,
    Popup,
    Source,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import polyline from "@mapbox/polyline";
import type { TrainFeatureProperties } from "@megisholavonat/api-client";
import {
    getTrainDetailsOptions,
    getTrainsOptions,
} from "@megisholavonat/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import type { GeoJSON as GeoJsonType } from "geojson";
import type { ExpressionSpecification } from "maplibre-gl";
import { AnimatePresence, motion } from "motion/react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DelayLegend } from "@/components/information/DelayLegend";
import { DragCloseDrawer } from "@/components/information/DragModal";
import { NoDataDialog } from "@/components/information/NoDataDialog";
import { TrainPanel } from "@/components/information/TrainPanel";
import { MapController } from "@/components/map/MapController";
import { MapImage } from "@/components/map/MapImage";
import { TrainTooltip } from "@/components/map/TrainTooltip";
import { USER_LOCATION_SVG, UserLocation } from "@/components/map/UserLocation";
import { useMapSettings } from "@/hooks/useMapSettings";
import { Z_LAYERS } from "@/util/constants";
import { OVERLAYS } from "@/util/mapConfigs";

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

export interface SearchSelection {
    vehicleId: string;
    timestamp: number;
}

export default function MapLibreComponent({
    searchSelection,
    onClearSearchSelection,
}: {
    searchSelection: SearchSelection | null;
    onClearSearchSelection?: () => void;
}) {
    const { showTooltip, vehicleTypeSettings, showRailwayOverlay } =
        useMapSettings();
    const { resolvedTheme } = useTheme();
    const mapRef = useRef<MapRef>(null);
    const { data: trains } = useQuery(getTrainsOptions());
    const [cursor, setCursor] = useState<string | null>(null);
    const [hoverInfo, setHoverInfo] = useState<TrainFeatureProperties | null>(
        null,
    );
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [showNoDataDialog, setShowNoDataDialog] = useState(false);

    const filteredTrains = useMemo(() => {
        if (!trains)
            return {
                type: "FeatureCollection" as const,
                features: [],
            };

        return {
            type: "FeatureCollection" as const,
            features: trains.features.filter((feature) => {
                const properties =
                    feature.properties as TrainFeatureProperties & {
                        type?: string;
                    };
                const type = properties.type;
                switch (type) {
                    case "train":
                        return vehicleTypeSettings.showTrains;
                    case "tramtrain":
                        return vehicleTypeSettings.showTramTrains;
                    case "hev":
                        return vehicleTypeSettings.showHev;
                    default:
                        return true;
                }
            }),
        };
    }, [trains, vehicleTypeSettings]);

    const { data: train } = useQuery({
        ...getTrainDetailsOptions({ path: { vehicle_id: selectedId ?? "" } }),
        enabled: !!selectedId,
    });

    useEffect(() => {
        if (searchSelection) {
            setSelectedId(searchSelection.vehicleId);
            setIsPanelOpen(true);
        }
    }, [searchSelection]);

    useEffect(() => {
        if (searchSelection && filteredTrains) {
            const feature = filteredTrains.features.find(
                (f) => f.properties.vehicleId === searchSelection.vehicleId,
            );
            if (feature && mapRef.current) {
                const { lon, lat } = feature.properties;
                mapRef.current.flyTo({
                    center: [lon, lat],
                    zoom: 14,
                    duration: 2000,
                });
            }
        }
    }, [searchSelection, filteredTrains]);

    const stopMarkersGeojson = useMemo(() => {
        if (!train?.trip?.stoptimes) return null;

        return {
            type: "FeatureCollection" as const,
            features: train.trip.stoptimes.map((stoptime) => {
                const processedStop = train.processedStops?.find(
                    (ps) => ps.id === stoptime.stop.name,
                );
                const hasPassed = processedStop
                    ? train.trainPosition > processedStop.distanceAlongRoute
                    : false;

                return {
                    type: "Feature" as const,
                    properties: {
                        name: stoptime.stop.name,
                        hasPassed,
                    },
                    geometry: {
                        type: "Point" as const,
                        coordinates: [stoptime.stop.lon, stoptime.stop.lat],
                    },
                };
            }),
        };
    }, [train]);

    const polylineGeojson = useMemo(() => {
        if (!train?.trip.tripGeometry) return null;

        return {
            type: "Feature" as const,
            properties: {},
            geometry: polyline.toGeoJSON(train.trip.tripGeometry.points),
        };
    }, [train]);

    const circleColor = useMemo(
        (): ExpressionSpecification =>
            [
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
            ] as ExpressionSpecification,
        [selectedId],
    );

    const typeColor = useMemo(
        (): ExpressionSpecification =>
            [
                "case",
                ["==", ["get", "type"], "tramtrain"],
                "#f9a825",
                ["==", ["get", "type"], "hev"],
                "#005e3b",
                "#252525",
            ] as ExpressionSpecification,
        [],
    );

    const mapStyle = useMemo(() => {
        return resolvedTheme === "dark"
            ? "https://tiles.openfreemap.org/styles/dark"
            : "https://tiles.openfreemap.org/styles/liberty";
    }, [resolvedTheme]);

    const railwayPaint = useMemo(() => {
        if (resolvedTheme === "dark") {
            return {
                "raster-opacity": 0.2,
            };
        }
        return {
            "raster-opacity": 0.6,
        };
    }, [resolvedTheme]);

    const onHover = useCallback(
        (e: MapMouseEvent) => {
            if (!showTooltip) return;
            const feature = e.features?.[0];
            if (feature && trains) {
                setCursor("pointer");

                setHoverInfo(feature.properties as TrainFeatureProperties);
            } else {
                setCursor(null);
                setHoverInfo(null);
            }
        },
        [trains, showTooltip],
    );

    const onClick = useCallback(
        (e: MapMouseEvent) => {
            const feature = e.features?.[0];
            if (feature) {
                const id = feature.properties.vehicleId;
                onClearSearchSelection?.();
                if (selectedId === id) {
                    setSelectedId(null);
                    setIsPanelOpen(false);
                } else {
                    setSelectedId(id);
                    setIsPanelOpen(true);
                }
            } else {
                setSelectedId(null);
                setIsPanelOpen(false);
            }
        },
        [selectedId, onClearSearchSelection],
    );

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && (selectedId || isPanelOpen)) {
                setSelectedId(null);
                setIsPanelOpen(false);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [selectedId, isPanelOpen]);

    useEffect(() => {
        const hasTrains = (trains?.features?.length ?? 0) > 0;
        const isVeryOld =
            trains?.dataAgeMinutes !== undefined &&
            trains.dataAgeMinutes !== null &&
            trains.dataAgeMinutes >= 15;

        if (trains?.noDataReceived || (isVeryOld && !hasTrains)) {
            setShowNoDataDialog(true);
        } else {
            setShowNoDataDialog(false);
        }
    }, [
        trains?.noDataReceived,
        trains?.dataAgeMinutes,
        trains?.features?.length,
    ]);

    return (
        <div className="relative h-full w-full bg-background">
            <AnimatePresence>
                {train && (
                    <>
                        <motion.div
                            className="hidden md:block md:w-1/2 lg:w-1/3 rounded-l-3xl bg-white border-l border-gray-300 overflow-hidden flex-col fixed right-0 top-0 h-full shadow-2xl"
                            style={{ zIndex: Z_LAYERS.PANELS }}
                            variants={desktopVariants}
                            initial="hidden"
                            animate="visible"
                            exit="exit"
                        >
                            <TrainPanel
                                vehicle={train}
                                onClose={() => {
                                    setSelectedId(null);
                                    setIsPanelOpen(false);
                                }}
                                showCloseButton={true}
                            />
                        </motion.div>
                        <div
                            className="md:hidden fixed bottom-0 left-0 right-0"
                            style={{ zIndex: Z_LAYERS.PANELS }}
                        >
                            <DragCloseDrawer
                                open={isPanelOpen}
                                setOpen={(open) => {
                                    setIsPanelOpen(open);
                                    if (!open) setSelectedId(null);
                                }}
                            >
                                <TrainPanel
                                    vehicle={train}
                                    showCloseButton={false}
                                />
                            </DragCloseDrawer>
                        </div>
                    </>
                )}
            </AnimatePresence>
            <div
                className="absolute bottom-4 right-4"
                style={{ zIndex: Z_LAYERS.MAP_CONTROLS }}
            >
                <DelayLegend
                    dataAgeMinutes={trains?.dataAgeMinutes ?? undefined}
                    hasTrains={!!trains?.features?.length}
                />
            </div>
            <NoDataDialog
                open={showNoDataDialog}
                onOpenChange={setShowNoDataDialog}
                dataAgeMinutes={trains?.dataAgeMinutes ?? undefined}
            />
            <MapLibreMap
                ref={mapRef}
                initialViewState={{
                    longitude: 19.045,
                    latitude: 47.499,
                    zoom: 13,
                }}
                maxPitch={0}
                dragRotate={false}
                style={{ width: "100vw", height: "100vh" }}
                mapStyle={mapStyle}
                interactiveLayerIds={["marker-main", "marker-heading"]}
                cursor={cursor ?? undefined}
                onClick={onClick}
                onMouseMove={onHover}
            >
                <MapImage id="marker-triangle" svg={SVG_TRIANGLE} sdf={true} />
                <MapImage
                    id="user-location-icon"
                    svg={USER_LOCATION_SVG}
                    sdf={true}
                />
                <UserLocation mapRef={mapRef} />
                <MapController
                    mapRef={mapRef}
                    selectedTrainId={selectedId}
                    trains={filteredTrains}
                    isPanelOpen={isPanelOpen}
                />
                {showRailwayOverlay && (
                    <Source
                        id="railway-source"
                        type="raster"
                        tiles={[
                            OVERLAYS.railway.url
                                .replace("{s}", "a")
                                .replace("{z}", "{z}")
                                .replace("{x}", "{x}")
                                .replace("{y}", "{y}"),
                        ]}
                        tileSize={256}
                    >
                        <Layer
                            id="railway-layer"
                            type="raster"
                            paint={railwayPaint}
                        />
                    </Source>
                )}
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
                {stopMarkersGeojson && (
                    <Source
                        id="stops-source"
                        type="geojson"
                        data={stopMarkersGeojson}
                    >
                        <Layer
                            id="stops-layer"
                            type="circle"
                            paint={{
                                "circle-radius": 6,
                                "circle-color": [
                                    "case",
                                    ["boolean", ["get", "hasPassed"], false],
                                    "#3b82f6", // blue-500
                                    "#ffffff", // white
                                ],
                                "circle-stroke-width": 2,
                                "circle-stroke-color": "#4b5563", // gray-600
                            }}
                        />
                        {showTooltip && (
                            <Layer
                                id="stops-labels"
                                type="symbol"
                                layout={{
                                    "text-field": ["get", "name"],
                                    "text-size": 14,
                                    "text-offset": [0, 1.5],
                                    "text-anchor": "top",
                                    "text-font": [
                                        "Open Sans Bold",
                                        "Arial Unicode MS Bold",
                                    ],
                                }}
                                paint={{
                                    "text-color": "#111827", // gray-900
                                    "text-halo-color": "#ffffff",
                                    "text-halo-width": 2,
                                }}
                            />
                        )}
                    </Source>
                )}
                <Source
                    id="vehicles-source"
                    type="geojson"
                    data={filteredTrains as unknown as GeoJsonType}
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
        </div>
    );
}
