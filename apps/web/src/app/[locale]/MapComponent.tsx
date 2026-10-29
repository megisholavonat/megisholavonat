"use client";
import {
    Layer,
    Map as MapLibreMap,
    type MapMouseEvent,
    type MapRef,
    Marker,
    Popup,
    Source,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import polyline from "@mapbox/polyline";
import type {
    Station,
    TrainFeatureCollection,
    TrainFeatureProperties,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";
import { getDelayLevel } from "@megisholavonat/core/delay";
import {
    COLORS,
    type ColorScheme,
    DELAY_SCALE,
    MARKER,
    STALE_COLORS,
} from "@megisholavonat/core/tokens";
import {
    createVehicleState,
    onPositionUpdate,
    setRoute,
    tick,
    type VehicleState,
} from "@megisholavonat/core/VehicleTracker";
import type {
    Feature,
    FeatureCollection,
    GeoJSON as GeoJsonType,
    LineString,
    Point,
} from "geojson";
import {
    type ExpressionSpecification,
    type GeoJSONSource,
    type Marker as MaplibreMarker,
    type Popup as MaplibrePopup,
    setWorkerUrl,
} from "maplibre-gl";
import { useReducedMotion } from "motion/react";
import {
    memo,
    type Ref,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { MapControls } from "@/components/map/MapControls";
import {
    arrowImageId,
    labelSize,
    markerImage,
    PILL_PADDING_X,
    pillHeight,
    stationImageId,
} from "@/components/map/markerImages";
import { TrainTooltip } from "@/components/map/TrainTooltip";
import { RouteGlyph } from "@/components/ui/RouteGlyph";
import { useTheme } from "@/components/ui/ThemeProvider";
import { useSettings } from "@/hooks/useSettings";
import { trainNumber } from "@/lib/train";
import { LAYER_IDS } from "@/util/constants";
import { OVERLAYS } from "@/util/mapConfigs";

// maplibre-gl 6 can't find its worker from inside a bundle; point it at the
// copy Next.js emits as a hashed asset.
setWorkerUrl(
    new URL(
        "maplibre-gl/dist/maplibre-gl-worker.mjs",
        import.meta.url,
    ).toString(),
);

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

// Interpolated train positions are pushed to the map at most this often.
const VEHICLE_FRAME_INTERVAL_MS = 1000 / 12;
// Skip setData unless some train moved more than this (degrees, ~0.1 m)…
const VEHICLE_COORD_EPSILON = 1e-6;
// …or turned more than this many degrees.
const VEHICLE_BEARING_EPSILON = 0.5;
/** Taps this close (px) to a marker select it: a 44 px touch target. */
const HIT_RADIUS = MARKER.hitArea / 2;

const STYLE_URLS: Record<ColorScheme, string> = {
    light: "https://tiles.openfreemap.org/styles/positron",
    dark: "https://tiles.openfreemap.org/styles/dark",
};

function bearingDelta(a: number, b: number): number {
    return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

const TOOLTIP_OFFSET: [number, number] = [0, -14];

// Memoized so MapComponent re-renders don't reset the popup to `info`'s
// coordinates; the animation loop moves it through `popupRef`.
const HoverTooltip = memo(function HoverTooltip({
    info,
    popupRef,
}: {
    info: TrainFeatureProperties;
    popupRef: Ref<MaplibrePopup>;
}) {
    return (
        <Popup
            ref={popupRef}
            longitude={info.lon}
            latitude={info.lat}
            offset={TOOLTIP_OFFSET}
            closeButton={false}
            closeOnClick={false}
            anchor="bottom"
            className="vehicle-tooltip"
        >
            <TrainTooltip featureProperties={info} />
        </Popup>
    );
});

/** Ink label above the selected train: route glyph, number (and speed). */
const SelectedLabel = memo(function SelectedLabel({
    info,
    markerRef,
    showSpeed,
}: {
    info: TrainFeatureProperties;
    markerRef: Ref<MaplibreMarker>;
    showSpeed: boolean;
}) {
    const level = info.isStale ? "stale" : getDelayLevel(info.delay);
    const offsetY = -(pillHeight(level) / 2 + 12);
    const speed = Math.round((info.speed ?? 0) * 3.6);
    return (
        <Marker
            ref={markerRef}
            longitude={info.lon}
            latitude={info.lat}
            anchor="bottom"
            offset={[0, offsetY]}
            style={{ pointerEvents: "none" }}
        >
            <div className="flex items-center gap-1 rounded-md bg-action px-1.5 py-0.5 text-caption font-bold text-on-action whitespace-nowrap shadow-sm">
                <RouteGlyph routeShortName={info.routeShortName} />
                <span className="tnum">
                    {trainNumber(info.tripShortName)}
                    {showSpeed && speed > 0 ? ` · ${speed} km/h` : ""}
                </span>
            </div>
        </Marker>
    );
});

// The arrow sits just outside the marker, rotated with the heading. Offsets
// are bucketed: icon-offset can only pick between literal arrays.
const ARROW_OFFSET_MIN = 12;
const ARROW_OFFSET_MAX = 40;
const ARROW_OFFSET_STEP = 2;
const ARROW_OFFSET = ((): ExpressionSpecification => {
    const cases: (number | ExpressionSpecification)[] = [];
    for (
        let offset = ARROW_OFFSET_MIN;
        offset <= ARROW_OFFSET_MAX;
        offset += ARROW_OFFSET_STEP
    ) {
        cases.push(offset, ["literal", [0, -offset]]);
    }
    return [
        "match",
        ["get", "arrowOffset"],
        ...cases,
        ["literal", [0, -ARROW_OFFSET_MIN]],
    ] as unknown as ExpressionSpecification;
})();

/** Marker level, shape and label, precomputed per train for the layers. */
function enrich(
    props: TrainFeatureProperties,
    nowS: number,
): Record<string, unknown> {
    const stale = !!props.isStale;
    const level = stale ? "stale" : getDelayLevel(props.delay);
    const label = stale
        ? MARKER.label.stale((nowS - props.lastUpdated) / 60)
        : level === "onTime"
          ? ""
          : MARKER.label.delayed(props.delay);
    // Rough label width, to keep the direction arrow clear of the pill
    const halfWidth = label
        ? (label.length * labelSize(level) * 0.62) / 2 + PILL_PADDING_X
        : MARKER.levels.onTime.height / 2;
    return {
        ...props,
        level,
        shape: props.type === "hev" ? "hev" : "train",
        label,
        arrowOffset: Math.min(
            ARROW_OFFSET_MAX,
            Math.max(
                ARROW_OFFSET_MIN,
                Math.round((halfWidth + 6) / ARROW_OFFSET_STEP) *
                    ARROW_OFFSET_STEP,
            ),
        ),
        // Bigger delays draw on top; stale trains at the bottom
        sortKey: stale ? -1 : props.delay,
    };
}

export interface FlyTarget {
    lon: number;
    lat: number;
    zoom?: number;
    /** Changes on every request, so the same place can be flown to twice */
    key: number;
}

export interface MapInsets {
    bottom: number;
    left: number;
}

export default function MapComponent({
    trains,
    selectedId,
    onSelectTrain,
    train,
    station,
    flyTarget,
    insets,
    isDesktop,
}: {
    trains: TrainFeatureCollection | undefined;
    selectedId: string | null;
    onSelectTrain: (vehicleId: string | null) => void;
    train: VehiclePositionWithDelay | undefined;
    station: Station | null;
    flyTarget: FlyTarget | null;
    insets: MapInsets;
    isDesktop: boolean;
}) {
    const settings = useSettings();
    const { resolvedTheme } = useTheme();
    const scheme: ColorScheme = resolvedTheme === "dark" ? "dark" : "light";
    const prefersReducedMotion = useReducedMotion() ?? false;
    const mapRef = useRef<MapRef>(null);
    const trackersRef = useRef<Map<string, VehicleState>>(new Map());
    const filteredTrainsRef = useRef<FeatureCollection | null>(null);
    const popupRef = useRef<MaplibrePopup>(null);
    const selectedMarkerRef = useRef<MaplibreMarker>(null);
    const lastHoveredIdRef = useRef<string | null>(null);
    const selectedIdRef = useRef(selectedId);
    const [cursor, setCursor] = useState<string | null>(null);
    const [hoverInfo, setHoverInfo] = useState<TrainFeatureProperties | null>(
        null,
    );
    const [mapLoaded, setMapLoaded] = useState(false);
    const insetsRef = useRef(insets);

    useEffect(() => {
        insetsRef.current = insets;
    }, [insets]);
    useEffect(() => {
        selectedIdRef.current = selectedId;
    }, [selectedId]);

    const filteredTrains = useMemo(() => {
        const nowS = Date.now() / 1000;
        const features = (trains?.features ?? []).filter((feature) => {
            switch (feature.properties.type) {
                case "train":
                    return settings.showTrains;
                case "tramtrain":
                    return settings.showTramTrains;
                case "hev":
                    return settings.showHev;
                default:
                    return true;
            }
        });
        return {
            type: "FeatureCollection" as const,
            features: features.map((feature) => ({
                type: "Feature" as const,
                geometry: feature.geometry as unknown as Point,
                properties: enrich(feature.properties, nowS),
            })),
        };
    }, [
        trains,
        settings.showTrains,
        settings.showTramTrains,
        settings.showHev,
    ]);

    const selectedInfo = useMemo(() => {
        if (!selectedId) return null;
        return (
            trains?.features.find((f) => f.properties.vehicleId === selectedId)
                ?.properties ?? null
        );
    }, [trains, selectedId]);

    // Fly to a requested place, keeping it clear of the sheet / side panel
    useEffect(() => {
        if (!flyTarget || !mapLoaded) return;
        const map = mapRef.current;
        if (!map) return;
        const { bottom, left } = insetsRef.current;
        map.flyTo({
            center: [flyTarget.lon, flyTarget.lat],
            zoom: Math.max(map.getZoom(), flyTarget.zoom ?? 13),
            duration: prefersReducedMotion ? 0 : 1600,
            padding: { top: 0, right: 0, bottom, left },
        });
    }, [flyTarget, mapLoaded, prefersReducedMotion]);

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

    // Keep the hovered tooltip's content in sync with fresh feed data. Its
    // position is moved imperatively by the animation loop below.
    useEffect(() => {
        const hoveredId = lastHoveredIdRef.current;
        if (!hoveredId) return;
        const feature = trains?.features.find(
            (f) => f.properties.vehicleId === hoveredId,
        );
        if (feature) setHoverInfo(feature.properties);
    }, [trains]);

    useEffect(() => {
        if (!mapLoaded || !settings.animateVehicles || prefersReducedMotion) {
            return;
        }
        const map = mapRef.current?.getMap();
        if (!map) return;

        let rafId: number | null = null;
        let lastFrameAt = Number.NEGATIVE_INFINITY;
        let lastSource: GeoJSONSource | undefined;
        let lastData: FeatureCollection | null = null;
        // Last [lon, lat, bearing] pushed to the source, per vehicle.
        const lastSent = new Map<string, [number, number, number]>();

        const update = (timestamp: number) => {
            const data = filteredTrainsRef.current;
            if (!data || !map.isStyleLoaded()) return;
            const source = map.getSource("vehicles-source") as
                | GeoJSONSource
                | undefined;
            if (!source) return;

            // New feed data or a re-created source (style change) must be
            // pushed even if no train moved.
            let changed = source !== lastSource || data !== lastData;
            const ticks = data.features.map((feature) => {
                const { vehicleId } =
                    feature.properties as TrainFeatureProperties;
                const state = trackersRef.current.get(vehicleId);
                if (!state) return null;
                const result = tick(state, timestamp);
                if (!changed) {
                    const prev = lastSent.get(vehicleId);
                    changed =
                        !prev ||
                        Math.abs(prev[0] - result.coords[0]) >
                            VEHICLE_COORD_EPSILON ||
                        Math.abs(prev[1] - result.coords[1]) >
                            VEHICLE_COORD_EPSILON ||
                        bearingDelta(prev[2], result.bearing) >
                            VEHICLE_BEARING_EPSILON;
                }
                return result;
            });
            if (!changed) return;

            lastSent.clear();
            const features = data.features.map((feature, i) => {
                const result = ticks[i];
                if (!result) return feature;
                const props = feature.properties as TrainFeatureProperties;
                const [lon, lat] = result.coords;
                lastSent.set(props.vehicleId, [lon, lat, result.bearing]);
                return {
                    ...feature,
                    geometry: {
                        type: "Point" as const,
                        coordinates: result.coords,
                    },
                    properties: {
                        ...feature.properties,
                        lon,
                        lat,
                        heading: result.bearing,
                    },
                };
            });
            source.setData({ type: "FeatureCollection", features });
            lastSource = source;
            lastData = data;

            // Keep the tooltip and the selected label on their moving
            // vehicles without re-rendering this component.
            const hoveredId = lastHoveredIdRef.current;
            const hovered = hoveredId ? lastSent.get(hoveredId) : undefined;
            if (hovered) popupRef.current?.setLngLat([hovered[0], hovered[1]]);
            const selected = selectedIdRef.current
                ? lastSent.get(selectedIdRef.current)
                : undefined;
            if (selected) {
                selectedMarkerRef.current?.setLngLat([
                    selected[0],
                    selected[1],
                ]);
            }
        };

        const frame = (timestamp: DOMHighResTimeStamp) => {
            rafId = requestAnimationFrame(frame);
            // Leave the map alone while the user pans or zooms.
            if (map.isMoving()) return;
            if (timestamp - lastFrameAt < VEHICLE_FRAME_INTERVAL_MS) return;
            lastFrameAt = timestamp;
            update(timestamp);
        };

        const start = () => {
            if (rafId !== null || document.visibilityState === "hidden") {
                return;
            }
            // Continue from where the trains were frozen instead of
            // catching up the paused time in one jump.
            for (const state of trackersRef.current.values()) {
                state.lastTimestamp = null;
            }
            rafId = requestAnimationFrame(frame);
        };
        const stop = () => {
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
        };
        const onVisibilityChange = () => {
            if (document.visibilityState === "hidden") stop();
            else start();
        };

        map.on("movestart", stop);
        map.on("moveend", start);
        document.addEventListener("visibilitychange", onVisibilityChange);
        start();

        return () => {
            stop();
            document.removeEventListener(
                "visibilitychange",
                onVisibilityChange,
            );
            try {
                map.off("movestart", stop);
                map.off("moveend", start);
            } catch {
                /* Map may already be removed (e.g. locale change / unmount). */
            }
        };
    }, [mapLoaded, settings.animateVehicles, prefersReducedMotion]);

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

    const stationGeojson = useMemo((): Feature<Point> | null => {
        if (!station) return null;
        return {
            type: "Feature",
            properties: { name: station.name },
            geometry: {
                type: "Point",
                coordinates: [station.lon, station.lat],
            },
        };
    }, [station]);

    const isSelected: ExpressionSpecification = useMemo(
        () => ["==", ["get", "vehicleId"], selectedId ?? ""],
        [selectedId],
    );

    // Other markers fade while a train is selected
    const markerOpacity = useMemo(
        (): ExpressionSpecification | number =>
            selectedId
                ? ["case", isSelected, 1, MARKER.selected.othersOpacity]
                : 1,
        [selectedId, isSelected],
    );

    const imageId = useCallback(
        (kind: "dot" | "pill"): ExpressionSpecification => [
            "concat",
            `mhav-${scheme}-${kind}-`,
            ["get", "level"],
            "-",
            ["get", "shape"],
            ["case", isSelected, "-sel", ""],
        ],
        [scheme, isSelected],
    );

    const sortKey: ExpressionSpecification = useMemo(
        () => ["case", isSelected, 100000, ["get", "sortKey"]],
        [isSelected],
    );

    const dotPaint = useMemo(() => {
        const scale = DELAY_SCALE[scheme];
        const stale = STALE_COLORS[scheme];
        const byLevel = (
            pick: (level: keyof typeof scale) => string | number,
            staleValue: string | number,
        ): ExpressionSpecification => [
            "match",
            ["get", "level"],
            "slight",
            pick("slight"),
            "moderate",
            pick("moderate"),
            "severe",
            pick("severe"),
            "stale",
            staleValue,
            pick("onTime"),
        ];
        return {
            "circle-radius": byLevel(
                (level) => MARKER.levels[level].dot / 2,
                MARKER.stale.dot / 2,
            ),
            "circle-color": byLevel(
                (level) => scale[level].fill,
                stale.background,
            ),
            "circle-stroke-width": [
                "case",
                isSelected,
                MARKER.selected.ringWidth,
                1,
            ] as ExpressionSpecification,
            "circle-stroke-color": [
                "case",
                isSelected,
                COLORS[scheme].ink,
                byLevel(
                    (level) => scale[level].outline.color,
                    stale.outline.color,
                ),
            ] as ExpressionSpecification,
            "circle-opacity": markerOpacity,
            "circle-stroke-opacity": markerOpacity,
        };
    }, [scheme, isSelected, markerOpacity]);

    const pillTextColor = useMemo((): ExpressionSpecification => {
        const scale = DELAY_SCALE[scheme];
        return [
            "match",
            ["get", "level"],
            "slight",
            scale.slight.label,
            "moderate",
            scale.moderate.label,
            "severe",
            scale.severe.label,
            "stale",
            STALE_COLORS[scheme].text,
            scale.onTime.label,
        ];
    }, [scheme]);

    // Marker sprites are drawn on first use. The resolver goes in as soon as
    // the map exists, before any layer asks for an image.
    const attachMap = useCallback((ref: MapRef | null) => {
        mapRef.current = ref;
        const map = ref?.getMap();
        if (!map) return;
        map.setMissingStyleImageResolver((id) => {
            if (map.hasImage(id)) return;
            const sprite = markerImage(id);
            if (sprite) {
                map.addImage(id, sprite.data, sprite.meta);
            } else {
                map.addImage(id, createTransparentBasemapIcon());
            }
        });
    }, []);

    // Match the basemap's land colour to the one the marker colours were
    // checked against
    useEffect(() => {
        if (!mapLoaded) return;
        const map = mapRef.current?.getMap();
        if (!map) return;
        const paintBackground = () => {
            for (const id of ["background", "Background"]) {
                if (map.getLayer(id)) {
                    map.setPaintProperty(
                        id,
                        "background-color",
                        COLORS[scheme].map,
                    );
                }
            }
        };
        paintBackground();
        map.on("style.load", paintBackground);
        return () => {
            try {
                map.off("style.load", paintBackground);
            } catch {
                /* Map may already be removed. */
            }
        };
    }, [mapLoaded, scheme]);

    const railwayPaint = useMemo(
        () => ({ "raster-opacity": scheme === "dark" ? 0.55 : 0.75 }),
        [scheme],
    );

    const markerLayerIds = useMemo(
        () => [
            LAYER_IDS.TRAIN_DOT,
            LAYER_IDS.TRAIN_PLAIN,
            LAYER_IDS.TRAIN_PILL,
        ],
        [],
    );

    const onHover = useCallback(
        (e: MapMouseEvent) => {
            if (!settings.showTooltip || !isDesktop) return;
            const feature = e.features?.[0];
            if (feature) {
                const props = feature.properties as TrainFeatureProperties;
                const newId = props.vehicleId;
                if (lastHoveredIdRef.current === newId) return;
                lastHoveredIdRef.current = newId;
                setCursor("pointer");
                const fresh = trains?.features.find(
                    (f) => f.properties.vehicleId === newId,
                );
                setHoverInfo(fresh?.properties ?? props);
            } else {
                if (lastHoveredIdRef.current === null) return;
                lastHoveredIdRef.current = null;
                setCursor(null);
                setHoverInfo(null);
            }
        },
        [trains, settings.showTooltip, isDesktop],
    );

    const onClick = useCallback(
        (e: MapMouseEvent) => {
            let feature = e.features?.[0];
            if (!feature) {
                // Small dots get a 44 px touch target
                const map = mapRef.current?.getMap();
                const { x, y } = e.point;
                const hits = map?.queryRenderedFeatures(
                    [
                        [x - HIT_RADIUS, y - HIT_RADIUS],
                        [x + HIT_RADIUS, y + HIT_RADIUS],
                    ],
                    { layers: markerLayerIds },
                );
                feature = hits?.sort((a, b) => {
                    const pa = map?.project(
                        (a.geometry as Point).coordinates as [number, number],
                    );
                    const pb = map?.project(
                        (b.geometry as Point).coordinates as [number, number],
                    );
                    const da = pa ? (pa.x - x) ** 2 + (pa.y - y) ** 2 : 0;
                    const db = pb ? (pb.x - x) ** 2 + (pb.y - y) ** 2 : 0;
                    return da - db;
                })[0];
            }
            const id = feature?.properties.vehicleId as string | undefined;
            onSelectTrain(id && id !== selectedId ? id : null);
        },
        [selectedId, onSelectTrain, markerLayerIds],
    );

    return (
        <div className="relative h-full w-full bg-map">
            <MapLibreMap
                ref={attachMap}
                initialViewState={{
                    longitude: 19.045,
                    latitude: 47.499,
                    zoom: 13,
                }}
                onLoad={() => setMapLoaded(true)}
                maxPitch={0}
                dragRotate={false}
                touchPitch={false}
                attributionControl={{ compact: !isDesktop }}
                style={{ width: "100%", height: "100%" }}
                mapStyle={STYLE_URLS[scheme]}
                interactiveLayerIds={markerLayerIds}
                cursor={cursor ?? undefined}
                onClick={onClick}
                onMouseMove={onHover}
                // [west, south, east, north]
                maxBounds={[5.5, 43, 30, 52.5]}
                minZoom={5}
                maxZoom={19}
                // Keep v5's overscaling past the basemap's max zoom; v6's
                // default (4) changes label placement at zoom 15+.
                zoomLevelsToOverscale={undefined}
            >
                <MapControls
                    isDesktop={isDesktop}
                    skipInitialFly={!!selectedId || !!station}
                />
                {settings.showRailwayOverlay && (
                    <Source
                        id="railway-source"
                        type="raster"
                        tiles={[OVERLAYS.railway.url.replace("{s}", "a")]}
                        tileSize={256}
                        attribution={OVERLAYS.railway.attribution}
                    >
                        <Layer
                            id={LAYER_IDS.RAILWAY}
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
                            id={LAYER_IDS.ROUTE_LINE}
                            type="line"
                            paint={{
                                "line-color": COLORS[scheme].ink,
                                "line-opacity": 0.72,
                                "line-width": 4,
                            }}
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
                            paint={{
                                "circle-radius": 4.5,
                                "circle-color": [
                                    "case",
                                    ["boolean", ["get", "hasPassed"], false],
                                    COLORS[scheme].ink2,
                                    COLORS[scheme].surface,
                                ],
                                "circle-stroke-width": 2,
                                "circle-stroke-color": COLORS[scheme].ink,
                            }}
                        />
                        {settings.showStationNames && (
                            <Layer
                                id={LAYER_IDS.STOP_LABELS}
                                type="symbol"
                                layout={{
                                    "text-field": ["get", "name"],
                                    "text-size": 13,
                                    "text-offset": [0, 1],
                                    "text-anchor": "top",
                                    "text-font": ["Noto Sans Bold"],
                                }}
                                paint={{
                                    "text-color": COLORS[scheme].ink,
                                    "text-halo-color": COLORS[scheme].map,
                                    "text-halo-width": 2,
                                    "text-opacity":
                                        settings.stationNamesOpacity,
                                }}
                            />
                        )}
                    </Source>
                )}
                {stationGeojson && (
                    <Source
                        id="station-source"
                        type="geojson"
                        data={stationGeojson}
                    >
                        <Layer
                            id={LAYER_IDS.STATION}
                            type="symbol"
                            layout={{
                                "icon-image": stationImageId(scheme),
                                "icon-allow-overlap": true,
                                "icon-ignore-placement": true,
                            }}
                        />
                    </Source>
                )}
                <Source
                    id="vehicles-source"
                    type="geojson"
                    data={filteredTrains as unknown as GeoJsonType}
                >
                    {/* Below zoom 9: unlabelled dots, size by severity */}
                    <Layer
                        id={LAYER_IDS.TRAIN_DOT}
                        type="circle"
                        maxzoom={MARKER.labelMinZoom}
                        layout={{ "circle-sort-key": sortKey }}
                        paint={dotPaint}
                    />
                    {/* Direction of travel */}
                    <Layer
                        id={LAYER_IDS.TRAIN_HEADING}
                        type="symbol"
                        minzoom={MARKER.labelMinZoom}
                        filter={["!=", ["get", "level"], "stale"]}
                        layout={{
                            "icon-image": arrowImageId(scheme),
                            "icon-rotate": ["coalesce", ["get", "heading"], 0],
                            "icon-rotation-alignment": "map",
                            "icon-allow-overlap": true,
                            "icon-ignore-placement": true,
                            "icon-offset": ARROW_OFFSET,
                        }}
                        paint={{ "icon-opacity": markerOpacity }}
                    />
                    {/* On time: a plain 16 px dot */}
                    <Layer
                        id={LAYER_IDS.TRAIN_PLAIN}
                        type="symbol"
                        minzoom={MARKER.labelMinZoom}
                        filter={["==", ["get", "level"], "onTime"]}
                        layout={{
                            "icon-image": imageId("dot"),
                            "icon-allow-overlap": true,
                            "icon-ignore-placement": true,
                            "symbol-sort-key": sortKey,
                        }}
                        paint={{ "icon-opacity": markerOpacity }}
                    />
                    {/* Late or stale: a pill with "+N" or "6′" */}
                    <Layer
                        id={LAYER_IDS.TRAIN_PILL}
                        type="symbol"
                        minzoom={MARKER.labelMinZoom}
                        filter={["!=", ["get", "level"], "onTime"]}
                        layout={{
                            "icon-image": imageId("pill"),
                            "icon-text-fit": "both",
                            "icon-allow-overlap": true,
                            "icon-ignore-placement": true,
                            "text-field": ["get", "label"],
                            "text-font": ["Noto Sans Bold"],
                            "text-size": [
                                "match",
                                ["get", "level"],
                                "severe",
                                labelSize("severe"),
                                "moderate",
                                labelSize("moderate"),
                                labelSize("slight"),
                            ],
                            "text-allow-overlap": true,
                            "text-ignore-placement": true,
                            "symbol-sort-key": sortKey,
                        }}
                        paint={{
                            "text-color": pillTextColor,
                            "icon-opacity": markerOpacity,
                            "text-opacity": markerOpacity,
                        }}
                    />
                </Source>
                {selectedInfo && (
                    <SelectedLabel
                        info={selectedInfo}
                        markerRef={selectedMarkerRef}
                        showSpeed={isDesktop}
                    />
                )}
                {hoverInfo && hoverInfo.vehicleId !== selectedId && (
                    <HoverTooltip info={hoverInfo} popupRef={popupRef} />
                )}
            </MapLibreMap>
        </div>
    );
}
