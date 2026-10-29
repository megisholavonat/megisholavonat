import {
    Camera,
    type CameraRef,
    GeoJSONSource,
    type GeoJSONSourceRef,
    Images,
    Layer,
    type LayerProps,
    Map as MapLibreMap,
    type MapRef,
    RasterSource,
    type StyleSpecification,
    type TrackUserLocation,
    UserLocation,
    type ViewStateChangeEvent,
} from "@maplibre/maplibre-react-native";
import type {
    TrainFeatureCollection,
    TrainFeatureProperties,
} from "@megisholavonat/api-client";
import { getTrainDetailsOptions } from "@megisholavonat/api-client/react-query";
import {
    basemapStyle,
    MAP_LAYER_IDS,
    NETWORK_SOURCE,
    networkLayer,
    STATIONS_SOURCE,
    stationLayers,
} from "@megisholavonat/core/mapStyle";
import { MAP_FOCUS } from "@megisholavonat/core/tokens/map";
import { useQuery } from "@tanstack/react-query";
import {
    type Ref,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    type NativeSyntheticEvent,
    StyleSheet,
    useWindowDimensions,
} from "react-native";
import { useLocale } from "use-intl";
import { API_URL, TILE_CACHE_URL } from "../config";
import { useSettings } from "../settings/SettingsProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { useReduceMotion } from "../ui/motion";
import { STACK_MAX, sheetPadding, shouldListStack } from "./camera";
import { getMapFocus, noteMapTap, useMapFocus } from "./focus";
import { StationLabel } from "./MapLabels";
import {
    basemapAnchors,
    clusterLayers,
    INITIAL_VIEW,
    MAX_BOUNDS,
    mapDataUrls,
    PINNED_SOURCE,
    RAILWAY_ATTRIBUTION,
    ROUTE_SOURCE,
    railwayPaint,
    railwayTileUrl,
    routeLayers,
    STATION_MARK_SOURCE,
    STOPS_SOURCE,
    stationMarkLayers,
    trainLayers,
} from "./mapStyle";
import { markerCollection } from "./markers";
import { routeLine, routeStops } from "./route";
import { useSelectedTrain } from "./selection";
import { SPRITE_IMAGES } from "./spriteImages";
import type { MapView } from "./useVehicleMotion";
import { VehicleSources } from "./VehicleSources";

const DATA_URLS = mapDataUrls(API_URL);
const MIN_ZOOM = 5;
const MAX_ZOOM = 19;
/** Flights and bubble zooms, as on the web (none with reduce motion) */
const FLY_MS = 1600;
const EASE_MS = 500;
const EMPTY: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [],
};

// Core types its style with a newer style-spec than MapLibre RN bundles; the
// JSON is the same
type CoreLayer = ReturnType<typeof networkLayer>;
const nativeLayer = (layer: CoreLayer) => layer as unknown as LayerProps;
const asLayer = (layer: unknown) => layer as LayerProps;

/**
 * The live map: our basemap with the passenger network and stations, the
 * opt-in OpenRailwayMap overlay, the selected train's route, the chosen
 * station and the trains, which glide along their routes (VehicleSources).
 *
 * Bottom to top: basemap fills and lines … border, network, railway
 * overlay, place names, station dots, station names, route, stops, station
 * clearing, "+N", bubbles, station ring, marks, then the selected and
 * followed trains' marks, ring, star, chips and arrow. Every app layer names
 * the layer it sits on (afterId), so a theme switch, which reloads the
 * native style, adds them back in the same places (web BL-1).
 */
export function TrainMap({
    trains,
    now,
    onTrainPress,
    followed,
    showRailways,
    followUser,
    onFollowUserChange,
    onStack,
    mapRef,
}: {
    trains: TrainFeatureCollection | undefined;
    /** Clock for staleness; ticks with the feed */
    now: Date;
    onTrainPress: (vehicleId: string) => void;
    /** Vehicle ids of followed trains */
    followed: readonly string[];
    showRailways: boolean;
    /** Show the user's position and keep the camera on it */
    followUser: boolean;
    onFollowUserChange: (following: boolean) => void;
    /**
     * Trains that still overlap at full zoom, to list (null closes the
     * list): a tap on their bubble
     */
    onStack: (trains: TrainFeatureProperties[] | null) => void;
    mapRef?: Ref<MapRef>;
}) {
    const theme = useAppTheme();
    const scheme = theme.dark ? "dark" : "light";
    const locale = useLocale();
    const selectedId = useSelectedTrain();
    const focus = useMapFocus();
    const reduceMotion = useReduceMotion();
    const { settings } = useSettings();
    const { height } = useWindowDimensions();

    const style = useMemo(
        () => basemapStyle(scheme, locale) as unknown as StyleSpecification,
        [scheme, locale],
    );
    const anchors = useMemo(() => basemapAnchors(style), [style]);

    // Focus: with a train open the network and stations step back
    const dim = selectedId !== null;
    const fadeMs = reduceMotion ? 0 : MAP_FOCUS.fadeMs;
    const network = useMemo(
        () => networkLayer({ scheme, dim, fadeMs }),
        [scheme, dim, fadeMs],
    );
    const names = settings.showStationNames;
    const namesOpacity = settings.stationNamesOpacity;
    const stations = useMemo(() => {
        const layers = stationLayers({
            scheme,
            dim,
            fadeMs,
            labelOpacity: namesOpacity,
        });
        return {
            dots: layers.dots,
            // Hidden rather than removed, so the layers above keep their
            // place
            labels: layers.labels.map((layer) => ({
                ...layer,
                layout: {
                    ...layer.layout,
                    visibility: names ? "visible" : "none",
                },
            })) as typeof layers.labels,
        };
    }, [scheme, dim, fadeMs, names, namesOpacity]);
    const route = useMemo(
        () =>
            routeLayers(scheme, {
                names,
                namesOpacity,
                railwayOverlay: showRailways,
            }),
        [scheme, names, namesOpacity, showRailways],
    );
    const stationMark = useMemo(() => stationMarkLayers(scheme), [scheme]);
    // Unselected trains cluster where they pile up and step back while one
    // is open; the selected and followed ones never do either (as on the
    // web)
    const clusters = useMemo(
        () => clusterLayers({ scheme, selectedId, fadeMs }),
        [scheme, selectedId, fadeMs],
    );
    const baseLayers = useMemo(() => {
        const layers = trainLayers({
            scheme,
            selectedId,
            dimmed: selectedId !== null,
            fadeMs,
        });
        return [
            asLayer({ ...layers.text, afterId: stationMark.clear.id }),
            asLayer({ ...clusters.bubble, afterId: layers.text.id }),
            asLayer({ ...clusters.count, afterId: clusters.bubble.id }),
            asLayer({ ...layers.marks, afterId: stationMark.ring.id }),
        ];
    }, [scheme, selectedId, fadeMs, clusters, stationMark]);
    const pinnedLayers = useMemo(() => {
        const layers = trainLayers({
            scheme,
            selectedId,
            source: PINNED_SOURCE,
            suffix: "-pinned",
            dimmed: false,
            fadeMs,
        });
        const marks = baseLayers[baseLayers.length - 1]?.id;
        return [
            asLayer({ ...layers.text, afterId: marks }),
            asLayer({ ...layers.marks, afterId: layers.text.id }),
            asLayer({ ...layers.ring, afterId: layers.marks.id }),
            asLayer({ ...layers.badge, afterId: layers.ring.id }),
            asLayer({ ...layers.chip, afterId: layers.badge.id }),
            // On top: it may point across the chip
            asLayer({ ...layers.arrow, afterId: layers.chip.id }),
        ];
    }, [scheme, selectedId, fadeMs, baseLayers]);

    // The open train's details, shared with its sheet (same query)
    const { data: details } = useQuery({
        ...getTrainDetailsOptions({ path: { vehicle_id: selectedId ?? "" } }),
        enabled: selectedId !== null,
        refetchOnMount: false,
    });
    const shown = selectedId !== null ? details : undefined;
    const line = useMemo(() => routeLine(shown), [shown]);
    const stops = useMemo(() => routeStops(shown), [shown]);

    const filter = useMemo(
        () => ({
            train: settings.showTrains,
            hev: settings.showHev,
            tramtrain: settings.showTramTrains,
        }),
        [settings.showTrains, settings.showHev, settings.showTramTrains],
    );
    const markers = useMemo(() => {
        const all = markerCollection(trains, scheme, now, new Set(followed), {
            filter,
            details: shown,
        });
        const pinned = (p: { vehicleId: string; followed: boolean }) =>
            p.followed || p.vehicleId === selectedId;
        return {
            base: {
                ...all,
                features: all.features.filter((f) => !pinned(f.properties)),
            },
            pinned: {
                ...all,
                features: all.features.filter((f) => pinned(f.properties)),
            },
        };
    }, [trains, scheme, now, followed, selectedId, filter, shown]);

    const selectedTrain = useMemo(
        () =>
            selectedId
                ? (trains?.features.find(
                      (f) => f.properties.vehicleId === selectedId,
                  )?.properties ?? null)
                : null,
        [trains, selectedId],
    );

    // What the map shows, for the animation and the camera
    const view = useRef<MapView>({
        zoom: INITIAL_VIEW.zoom,
        bounds: null,
        moving: false,
    });
    // The labels' offsets follow the zoom, in half steps
    const [zoom, setZoom] = useState(INITIAL_VIEW.zoom);
    const onRegionWillChange = useCallback(
        (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
            view.current.moving = true;
            if (event.nativeEvent.userInteraction) onStack(null);
        },
        [onStack],
    );
    const onRegionDidChange = useCallback(
        (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
            const { zoom: z, bounds } = event.nativeEvent;
            view.current = { zoom: z, bounds, moving: false };
            setZoom(Math.round(z * 2) / 2);
        },
        [],
    );

    const animate = settings.animateVehicles && !reduceMotion;
    const cameraRef = useRef<CameraRef>(null);
    const padding = useCallback(
        () => ({ bottom: sheetPadding(getMapFocus().sheet, height) }),
        [height],
    );

    // Fly where a sheet asks: a train opened from search, a list or a
    // follow, or a station, kept clear of the sheet (as on the web)
    const flown = useRef<number | null>(null);
    useEffect(() => {
        const target = focus.fly;
        if (!target || flown.current === target.key) return;
        let center: [number, number] | null = null;
        if (target.kind === "place") center = [target.lon, target.lat];
        else {
            if (!trains) return; // Waits for the feed
            const feature = trains.features.find(
                (f) => f.properties.vehicleId === target.vehicleId,
            );
            if (feature) {
                center = [feature.properties.lon, feature.properties.lat];
            }
        }
        flown.current = target.key;
        if (!center) return; // Not on the map (yet): the sheet still opens
        cameraRef.current?.flyTo({
            center,
            zoom: Math.min(MAX_ZOOM, Math.max(view.current.zoom, target.zoom)),
            duration: reduceMotion ? 0 : FLY_MS,
            easing: "fly",
            padding: padding(),
        });
    }, [focus.fly, trains, reduceMotion, padding]);

    // Tapping a bubble zooms in until its trains come apart; trains that
    // would still overlap (a station's platforms) are listed instead
    const vehiclesRef = useRef<GeoJSONSourceRef>(null);
    const lastPress = useRef(0);
    const trainsRef = useRef(trains);
    trainsRef.current = trains;
    const onVehiclePress = useCallback(
        (event: { nativeEvent: { features: GeoJSON.Feature[] } }) => {
            lastPress.current = Date.now();
            const feature = event.nativeEvent.features[0];
            const props = feature?.properties;
            if (props?.cluster && feature?.geometry.type === "Point") {
                const center = feature.geometry.coordinates as [number, number];
                const id = props.cluster_id as number;
                const source = vehiclesRef.current;
                if (!source) return;
                Promise.all([
                    source.getClusterExpansionZoom(id),
                    source.getClusterLeaves(id, STACK_MAX, 0),
                ])
                    .then(([expansion, leaves]) => {
                        const points = leaves.flatMap((leaf) =>
                            leaf.geometry.type === "Point"
                                ? [
                                      leaf.geometry.coordinates as [
                                          number,
                                          number,
                                      ],
                                  ]
                                : [],
                        );
                        if (shouldListStack(points, expansion, MAX_ZOOM)) {
                            const byId = new Map(
                                (trainsRef.current?.features ?? []).map((f) => [
                                    f.properties.vehicleId,
                                    f,
                                ]),
                            );
                            const listed = leaves
                                .map(
                                    (leaf) =>
                                        leaf.properties as {
                                            vehicleId: string;
                                            sort: number;
                                            delay: number;
                                        },
                                )
                                // Bigger delays first, as on the web
                                .sort(
                                    (a, b) =>
                                        b.sort - a.sort || b.delay - a.delay,
                                )
                                .flatMap((p) => {
                                    const train = byId.get(p.vehicleId);
                                    return train ? [train.properties] : [];
                                });
                            onStack(listed);
                            return;
                        }
                        cameraRef.current?.easeTo({
                            center,
                            zoom: Math.min(expansion + 0.5, MAX_ZOOM),
                            duration: reduceMotion ? 0 : EASE_MS,
                            padding: padding(),
                        });
                    })
                    .catch(() => {
                        // The bubble is gone after a feed update; ignore
                    });
                return;
            }
            const vehicleId = props?.vehicleId;
            if (typeof vehicleId === "string") {
                onStack(null);
                // Already in view: its sheet doesn't fly the map
                noteMapTap(vehicleId);
                onTrainPress(vehicleId);
            }
        },
        [onTrainPress, onStack, reduceMotion, padding],
    );
    const onMapPress = useCallback(() => {
        // A tap on a train reaches the map too; only other taps close
        if (Date.now() - lastPress.current > 400) onStack(null);
    }, [onStack]);

    const station = focus.station;
    const stationData = useMemo(
        (): GeoJSON.FeatureCollection =>
            station
                ? {
                      type: "FeatureCollection",
                      features: [
                          {
                              type: "Feature",
                              properties: { name: station.name },
                              geometry: {
                                  type: "Point",
                                  coordinates: [station.lon, station.lat],
                              },
                          },
                      ],
                  }
                : EMPTY,
        [station],
    );

    const trackUserLocation: TrackUserLocation | undefined = followUser
        ? "default"
        : undefined;

    const lastDot = stations.dots[stations.dots.length - 1]?.id;
    const lastLabel = stations.labels[stations.labels.length - 1]?.id;

    return (
        <MapLibreMap
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            mapStyle={style}
            // The overlay draws its own attribution button, which opens
            // the native attribution list (see MapControls)
            attribution={false}
            logo={false}
            compass={false}
            touchPitch={false}
            touchRotate={false}
            onPress={onMapPress}
            onRegionWillChange={onRegionWillChange}
            onRegionDidChange={onRegionDidChange}
        >
            <Camera
                ref={cameraRef}
                initialViewState={INITIAL_VIEW}
                minZoom={MIN_ZOOM}
                maxZoom={MAX_ZOOM}
                maxBounds={MAX_BOUNDS}
                trackUserLocation={trackUserLocation}
                onTrackUserLocationChange={(event) =>
                    onFollowUserChange(
                        event.nativeEvent.trackUserLocation !== null,
                    )
                }
            />
            <Images images={SPRITE_IMAGES} />
            <GeoJSONSource id={NETWORK_SOURCE} data={DATA_URLS.network}>
                <Layer {...nativeLayer(network)} afterId={anchors.belowNames} />
            </GeoJSONSource>
            {showRailways ? (
                <RasterSource
                    id="railway-source"
                    tiles={[railwayTileUrl(TILE_CACHE_URL)]}
                    tileSize={256}
                    attribution={RAILWAY_ATTRIBUTION}
                >
                    <Layer
                        id="railway"
                        type="raster"
                        afterId={MAP_LAYER_IDS.network}
                        paint={railwayPaint(scheme)}
                    />
                </RasterSource>
            ) : null}
            <GeoJSONSource id={STATIONS_SOURCE} data={DATA_URLS.stations}>
                {stations.dots.map((layer, i) => (
                    <Layer
                        key={layer.id}
                        {...nativeLayer(layer)}
                        afterId={stations.dots[i - 1]?.id ?? anchors.top}
                    />
                ))}
                {stations.labels.map((layer, i) => (
                    <Layer
                        key={layer.id}
                        {...nativeLayer(layer)}
                        afterId={stations.labels[i - 1]?.id ?? lastDot}
                    />
                ))}
            </GeoJSONSource>
            <GeoJSONSource id={ROUTE_SOURCE} data={line}>
                <Layer {...route.casing} afterId={lastLabel} />
                <Layer {...route.line} afterId={route.casing.id} />
            </GeoJSONSource>
            <GeoJSONSource id={STOPS_SOURCE} data={stops}>
                <Layer {...route.stops} afterId={route.line.id} />
                <Layer {...route.stopLabels} afterId={route.stops.id} />
            </GeoJSONSource>
            {/* Always mounted, so its layers keep their place in the order */}
            <GeoJSONSource id={STATION_MARK_SOURCE} data={stationData}>
                <Layer {...stationMark.clear} afterId={route.stopLabels.id} />
                {/* Above the bubbles, under the marks */}
                <Layer {...stationMark.ring} afterId={clusters.count.id} />
            </GeoJSONSource>
            {followUser ? <UserLocation /> : null}
            <VehicleSources
                trains={trains}
                base={markers.base}
                pinned={markers.pinned}
                baseLayers={baseLayers}
                pinnedLayers={pinnedLayers}
                selected={selectedTrain}
                animate={animate}
                reduceMotion={reduceMotion}
                view={view}
                zoom={zoom}
                vehiclesRef={vehiclesRef}
                onPress={onVehiclePress}
            />
            {station ? <StationLabel station={station} /> : null}
        </MapLibreMap>
    );
}
