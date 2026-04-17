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
import type {
    FeatureCollection,
    GeoJSON as GeoJsonType,
    LineString,
} from "geojson";
import type { ExpressionSpecification, GeoJSONSource } from "maplibre-gl";
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
import { UserLocation } from "@/components/map/UserLocation";
import { ZoomButtons } from "@/components/map/ZoomButtons";
import { useMapSettings } from "@/hooks/useMapSettings";
import {
    createVehicleState,
    onPositionUpdate,
    setRoute,
    tick,
    type VehicleState,
} from "@/lib/VehicleTracker";
import { LAYER_IDS, Z_LAYERS } from "@/util/constants";
import { OVERLAYS } from "@/util/mapConfigs";

const BASEMAP_MISSING_ICON_PX = 16;

function createTransparentBasemapIcon(): ImageData {
    return new ImageData(
        new Uint8ClampedArray(
            BASEMAP_MISSING_ICON_PX * BASEMAP_MISSING_ICON_PX * 4,
        ),
        BASEMAP_MISSING_ICON_PX,
        BASEMAP_MISSING_ICON_PX,
    );
}

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

export default function MapComponent({
    searchSelection,
    onClearSearchSelection,
}: {
    searchSelection: SearchSelection | null;
    onClearSearchSelection?: () => void;
}) {
    const {
        showTooltip,
        showStationNames,
        stationNamesOpacity,
        vehicleTypeSettings,
        showRailwayOverlay,
        animateVehicles,
    } = useMapSettings();
    const { resolvedTheme } = useTheme();
    const mapRef = useRef<MapRef>(null);
    const trackersRef = useRef<Map<string, VehicleState>>(new Map());
    const filteredTrainsRef = useRef<FeatureCollection | null>(null);
    const rafRef = useRef<number | null>(null);
    /** Last vehicle under the pointer; used to sync tooltip position while the vehicle animates. */
    const lastHoveredIdRef = useRef<string | null>(null);
    const { data: trains } = useQuery(getTrainsOptions());
    const [cursor, setCursor] = useState<string | null>(null);
    const [hoverInfo, setHoverInfo] = useState<TrainFeatureProperties | null>(
        null,
    );

    // Read the vehicleId from the URL once on mount (component is ssr:false so window is always available)
    const [initialUrlVehicleId] = useState<string | null>(() =>
        new URLSearchParams(window.location.search).get("vehicleId"),
    );
    const [selectedId, setSelectedId] = useState<string | null>(
        initialUrlVehicleId,
    );
    const [isPanelOpen, setIsPanelOpen] = useState(!!initialUrlVehicleId);
    const [showNoDataDialog, setShowNoDataDialog] = useState(false);

    const [mapLoaded, setMapLoaded] = useState(false);

    // Refs for URL sync and initial fly-to
    const isFirstUrlSyncRef = useRef(true);
    const hasHandledInitialFlyRef = useRef(false);

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
        refetchInterval: selectedId ? 5000 : false,
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

    // Sync selectedId → URL (skip on the very first run so we don't clobber an existing URL param)
    useEffect(() => {
        if (isFirstUrlSyncRef.current) {
            isFirstUrlSyncRef.current = false;
            return;
        }
        const params = new URLSearchParams(window.location.search);
        if (selectedId) {
            params.set("vehicleId", selectedId);
        } else {
            params.delete("vehicleId");
        }
        const search = params.toString();
        window.history.replaceState(
            null,
            "",
            `${window.location.pathname}${search ? `?${search}` : ""}`,
        );
    }, [selectedId]);

    // Fly to the vehicle that was in the URL on load; clear the selection if it no longer exists.
    // Wait for BOTH trains data and the map to be ready — if trains load from cache before the
    // map finishes initializing, mapRef.current is null and we must not misinterpret that as
    // "train not found".
    useEffect(() => {
        if (
            hasHandledInitialFlyRef.current ||
            !initialUrlVehicleId ||
            !trains ||
            !mapLoaded
        )
            return;

        const feature = filteredTrains.features.find(
            (f) => f.properties.vehicleId === initialUrlVehicleId,
        );

        hasHandledInitialFlyRef.current = true;

        if (feature) {
            mapRef.current?.flyTo({
                center: [feature.properties.lon, feature.properties.lat],
                zoom: 14,
                duration: 2000,
            });
        } else {
            // Train is no longer available — clear selection and remove from URL
            setSelectedId(null);
            setIsPanelOpen(false);
        }
    }, [trains, filteredTrains, initialUrlVehicleId, mapLoaded]);

    useEffect(() => {
        filteredTrainsRef.current =
            filteredTrains as unknown as FeatureCollection;
    }, [filteredTrains]);

    useEffect(() => {
        if (!trains) return;

        const activeIds = new Set<string>();

        for (const feature of trains.features) {
            const props = feature.properties as TrainFeatureProperties;
            const {
                vehicleId,
                lon,
                lat,
                heading,
                speed,
                routePolyline,
                distanceToNextStop,
            } = props;
            activeIds.add(vehicleId);
            let state = trackersRef.current.get(vehicleId);

            if (!state) {
                state = createVehicleState();
                trackersRef.current.set(vehicleId, state);
            }

            if (routePolyline) {
                setRoute(state, {
                    type: "Feature",
                    properties: {},
                    geometry: polyline.toGeoJSON(routePolyline) as LineString,
                });
            }
            // API returns speed in m/s (GTFS-RT); convert to km/h for dead reckoning.
            // distanceToNextStop is already in km (computed on backend).
            onPositionUpdate(
                state,
                [lon, lat],
                (speed ?? 0) * 3.6,
                heading ?? 0,
                distanceToNextStop ?? null,
            );
        }
        // Remove trackers for vehicles that are no longer in the feed
        for (const id of trackersRef.current.keys()) {
            if (!activeIds.has(id)) trackersRef.current.delete(id);
        }
    }, [trains]);

    useEffect(() => {
        if (!mapLoaded || !animateVehicles) return;

        const animate = (timestamp: DOMHighResTimeStamp) => {
            const map = mapRef.current?.getMap();
            if (map?.isStyleLoaded() && filteredTrainsRef.current) {
                const source = map.getSource("vehicles-source") as
                    | GeoJSONSource
                    | undefined;
                if (source) {
                    const features = filteredTrainsRef.current.features.map(
                        (feature) => {
                            const props =
                                feature.properties as TrainFeatureProperties;
                            const state = trackersRef.current.get(
                                props.vehicleId,
                            );
                            if (!state) return feature;
                            const result = tick(state, timestamp);
                            return {
                                ...feature,
                                geometry: {
                                    type: "Point" as const,
                                    coordinates: result.coords,
                                },
                                properties: {
                                    ...feature.properties,
                                    lon: result.coords[0],
                                    lat: result.coords[1],
                                    heading: result.bearing,
                                },
                            };
                        },
                    );
                    source.setData({
                        type: "FeatureCollection",
                        features,
                    });

                    // Keep popup anchored when the vehicle moves without new mousemove events.
                    const hoveredId = lastHoveredIdRef.current;
                    if (showTooltip && hoveredId) {
                        const hoveredFeature = features.find(
                            (f) =>
                                (f.properties as TrainFeatureProperties)
                                    .vehicleId === hoveredId,
                        );
                        if (hoveredFeature) {
                            const nextProps =
                                hoveredFeature.properties as TrainFeatureProperties;
                            setHoverInfo((prev) => {
                                if (!prev || prev.vehicleId !== hoveredId) {
                                    return prev;
                                }
                                if (
                                    prev.lon === nextProps.lon &&
                                    prev.lat === nextProps.lat &&
                                    prev.heading === nextProps.heading
                                ) {
                                    return prev;
                                }
                                return nextProps;
                            });
                        }
                    }
                }
            }
            rafRef.current = requestAnimationFrame(animate);
        };

        rafRef.current = requestAnimationFrame(animate);
        return () => {
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
        };
    }, [mapLoaded, animateVehicles, showTooltip]);

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
                "#00bcd4", // Selected blue
                [
                    "step",
                    ["coalesce", ["get", "delay"], 0],
                    "#4AD94A", // green
                    5,
                    "#E4DE3A", // yellow
                    15,
                    "#DF9227", // orange
                    60,
                    "#D9564A", // red
                ],
            ] as ExpressionSpecification,
        [selectedId],
    );

    const typeColor = useMemo(
        (): ExpressionSpecification =>
            [
                "case",
                ["==", ["get", "type"], "tramtrain"],
                "#f9a825", // tramtrain orange
                ["==", ["get", "type"], "hev"],
                "#009860", // hev green
                "#2f4550", // dark blue-ish
            ] as ExpressionSpecification,
        [],
    );

    const mapStyle = useMemo(() => {
        return resolvedTheme === "dark"
            ? "https://tiles.openfreemap.org/styles/dark"
            : "https://tiles.openfreemap.org/styles/liberty";
    }, [resolvedTheme]);

    useEffect(() => {
        if (!mapLoaded) return;
        const map = mapRef.current?.getMap();
        if (!map) return;

        const onStyleImageMissing = (ev: { id: string }) => {
            if (!map.hasImage(ev.id)) {
                map.addImage(ev.id, createTransparentBasemapIcon());
            }
        };

        map.on("styleimagemissing", onStyleImageMissing);
        return () => {
            map.off("styleimagemissing", onStyleImageMissing);
        };
    }, [mapLoaded]);

    const railwayPaint = useMemo(() => {
        if (resolvedTheme === "dark") {
            return {
                "raster-opacity": 0.6,
            };
        }
        return {
            "raster-opacity": 0.8,
        };
    }, [resolvedTheme]);

    const onHover = useCallback(
        (e: MapMouseEvent) => {
            if (!showTooltip) return;
            const feature = e.features?.[0];
            if (feature && trains) {
                const newId = (feature.properties as TrainFeatureProperties)
                    .vehicleId;

                const isSameVehicle = lastHoveredIdRef.current === newId;
                if (!isSameVehicle) {
                    lastHoveredIdRef.current = newId;
                    setCursor("pointer");
                }
                // When vehicles animate, lon/lat/heading must come only from the RAF/tick path so
                // they match the rendered symbol. Map queryFeature properties can differ slightly and
                // fighting both updates causes visible jitter.
                if (animateVehicles && isSameVehicle) {
                    return;
                }
                setHoverInfo(feature.properties as TrainFeatureProperties);
            } else {
                if (lastHoveredIdRef.current === null) return;
                lastHoveredIdRef.current = null;
                setCursor(null);
                setHoverInfo(null);
            }
        },
        [trains, showTooltip, animateVehicles],
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
                onLoad={() => setMapLoaded(true)}
                maxPitch={0}
                dragRotate={false}
                attributionControl={false}
                style={{ width: "100vw", height: "100vh" }}
                mapStyle={mapStyle}
                interactiveLayerIds={[
                    LAYER_IDS.TRAIN_MAIN,
                    LAYER_IDS.TRAIN_HEADING,
                ]}
                cursor={cursor ?? undefined}
                onClick={onClick}
                onMouseMove={onHover}
            >
                <MapImage id="marker-triangle" svg={SVG_TRIANGLE} sdf={true} />
                <ZoomButtons />
                <UserLocation disableInitialFly={!!initialUrlVehicleId} />
                <MapController
                    mapRef={mapRef}
                    selectedTrainId={selectedId}
                    trains={filteredTrains}
                    isPanelOpen={isPanelOpen}
                />
                <Source
                    id="vehicles-source"
                    type="geojson"
                    data={filteredTrains as unknown as GeoJsonType}
                >
                    <Layer
                        id={LAYER_IDS.TRAIN_HEADING}
                        type="symbol"
                        layout={{
                            "icon-image": "marker-triangle",
                            "icon-size": 0.65,
                            "icon-rotate": ["coalesce", ["get", "heading"], 0],
                            "icon-rotation-alignment": "map",
                            "icon-allow-overlap": true,
                            "icon-ignore-placement": true,
                            "icon-offset": [0, -10], // Push out
                        }}
                        paint={{
                            "icon-color": typeColor,
                        }}
                    />
                    <Layer
                        id={LAYER_IDS.TRAIN_MAIN}
                        type="circle"
                        paint={{
                            "circle-radius": 8,
                            "circle-color": circleColor,
                            "circle-stroke-width": 2.5,
                            "circle-stroke-color": typeColor,
                        }}
                    />
                </Source>
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
                            id={LAYER_IDS.RAILWAY}
                            type="raster"
                            beforeId={LAYER_IDS.TRAIN_HEADING}
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
                            id={LAYER_IDS.ROUTE_LINE}
                            type="line"
                            beforeId={LAYER_IDS.TRAIN_HEADING}
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
                            id={LAYER_IDS.STOP_CIRCLES}
                            type="circle"
                            beforeId={LAYER_IDS.TRAIN_HEADING}
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
                        {showStationNames && (
                            <Layer
                                id={LAYER_IDS.STOP_LABELS}
                                type="symbol"
                                beforeId={LAYER_IDS.TRAIN_HEADING}
                                layout={{
                                    "text-field": ["get", "name"],
                                    "text-size": 14,
                                    "text-offset": [0, 1.5],
                                    "text-anchor": "top",
                                    "text-font": ["Noto Sans Bold"],
                                }}
                                paint={{
                                    "text-color": "#111827", // gray-900
                                    "text-halo-color": "#ffffff",
                                    "text-halo-width": 2,
                                    "text-opacity": stationNamesOpacity,
                                }}
                            />
                        )}
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
        </div>
    );
}
