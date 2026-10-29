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
} from "@maplibre/maplibre-react-native";
import type { TrainFeatureCollection } from "@megisholavonat/api-client";
import { getTrainDetailsOptions } from "@megisholavonat/api-client/react-query";
import {
    basemapStyle,
    MAP_LAYER_IDS,
    NETWORK_SOURCE,
    networkLayer,
    STATIONS_SOURCE,
    stationLayers,
} from "@megisholavonat/core/mapStyle";
import { TOUCH_TARGET } from "@megisholavonat/core/tokens";
import { MAP_FOCUS, MAP_MARKS } from "@megisholavonat/core/tokens/map";
import { useQuery } from "@tanstack/react-query";
import { type Ref, useCallback, useMemo, useRef } from "react";
import { StyleSheet } from "react-native";
import { useLocale } from "use-intl";
import { API_URL, TILE_CACHE_URL } from "../config";
import { useAppTheme } from "../theme/ThemeProvider";
import { useReduceMotion } from "../ui/motion";
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
    STOPS_SOURCE,
    trainLayers,
    VEHICLES_SOURCE,
} from "./mapStyle";
import { markerCollection } from "./markers";
import { routeLine, routeStops } from "./route";
import { useSelectedTrain } from "./selection";
import { SPRITE_IMAGES } from "./spriteImages";

const HIT = TOUCH_TARGET / 2;
/** Trains still piled up this close in are not clustered (as on the web) */
const CLUSTER_MAX_ZOOM = 15;
const DATA_URLS = mapDataUrls(API_URL);

// Core types its style with a newer style-spec than MapLibre RN bundles; the
// JSON is the same
/** From this zoom the railway overlay writes out station names */
const RAILWAY_NAMES_MIN_ZOOM = 10.5;
type CoreLayer = ReturnType<typeof networkLayer>;
const nativeLayer = (layer: CoreLayer) => layer as unknown as LayerProps;

/**
 * The live map: our basemap with the passenger network and stations, the
 * opt-in OpenRailwayMap overlay, the selected train's route and the trains.
 *
 * Bottom to top: basemap fills and lines … border, network, railway
 * overlay, place names, station dots, station names, route, stops, "+N",
 * marks, ring, badge, chips. Every app layer names the layer it sits on
 * (afterId), so a theme switch, which reloads the native style, adds them
 * back in the same places (web BL-1).
 */
export function TrainMap({
    trains,
    now,
    onTrainPress,
    followed,
    showRailways,
    followUser,
    onFollowUserChange,
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
    mapRef?: Ref<MapRef>;
}) {
    const theme = useAppTheme();
    const scheme = theme.dark ? "dark" : "light";
    const locale = useLocale();
    const selectedId = useSelectedTrain();
    const reduceMotion = useReduceMotion();

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
    const stations = useMemo(
        () =>
            stationLayers({
                scheme,
                dim,
                fadeMs,
                // The overlay names stations itself from this zoom
                labelMaxZoom: showRailways ? RAILWAY_NAMES_MIN_ZOOM : undefined,
            }),
        [scheme, dim, fadeMs, showRailways],
    );
    const route = useMemo(() => routeLayers(scheme), [scheme]);
    // Unselected trains cluster where they pile up; the selected and
    // followed ones never do (as on the web)
    const layers = useMemo(
        () => trainLayers({ scheme, selectedId }),
        [scheme, selectedId],
    );
    const pinnedLayers = useMemo(
        () =>
            trainLayers({
                scheme,
                selectedId,
                source: PINNED_SOURCE,
                suffix: "-pinned",
            }),
        [scheme, selectedId],
    );
    const clusters = useMemo(
        () => clusterLayers({ scheme, selectedId }),
        [scheme, selectedId],
    );

    // The open train's details, shared with its sheet (same query)
    const { data: details } = useQuery({
        ...getTrainDetailsOptions({ path: { vehicle_id: selectedId ?? "" } }),
        enabled: selectedId !== null,
        refetchOnMount: false,
    });
    const shown = selectedId !== null ? details : undefined;
    const line = useMemo(() => routeLine(shown), [shown]);
    const stops = useMemo(() => routeStops(shown), [shown]);

    const markers = useMemo(() => {
        const all = markerCollection(trains, scheme, now, new Set(followed));
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
    }, [trains, scheme, now, followed, selectedId]);

    // Tapping a bubble zooms in until its trains come apart
    const vehiclesRef = useRef<GeoJSONSourceRef>(null);
    const cameraRef = useRef<CameraRef>(null);
    const onVehiclePress = useCallback(
        async (feature: GeoJSON.Feature | undefined) => {
            const props = feature?.properties;
            if (props?.cluster && feature?.geometry.type === "Point") {
                try {
                    const zoom =
                        await vehiclesRef.current?.getClusterExpansionZoom(
                            props.cluster_id as number,
                        );
                    if (zoom === undefined) return;
                    cameraRef.current?.easeTo({
                        center: feature.geometry.coordinates as [
                            number,
                            number,
                        ],
                        zoom: zoom + 0.5,
                        duration: reduceMotion ? 0 : 500,
                    });
                } catch {
                    // The cluster is gone after a feed update; ignore the tap
                }
                return;
            }
            const vehicleId = props?.vehicleId;
            if (typeof vehicleId === "string") onTrainPress(vehicleId);
        },
        [onTrainPress, reduceMotion],
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
        >
            <Camera
                ref={cameraRef}
                initialViewState={INITIAL_VIEW}
                minZoom={5}
                maxZoom={19}
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
            {followUser ? <UserLocation /> : null}
            <GeoJSONSource
                ref={vehiclesRef}
                id={VEHICLES_SOURCE}
                data={markers.base}
                cluster
                clusterRadius={MAP_MARKS.clusterRadius}
                clusterMinPoints={MAP_MARKS.clusterMinPoints}
                clusterMaxZoom={CLUSTER_MAX_ZOOM}
                hitbox={{ top: HIT, right: HIT, bottom: HIT, left: HIT }}
                onPress={(event) =>
                    void onVehiclePress(event.nativeEvent.features[0])
                }
            >
                {/* Under the station names, which are placed first */}
                <Layer {...layers.text} afterId={lastDot} />
                <Layer {...layers.room} afterId={layers.text.id} />
                <Layer {...clusters.bubble} afterId={route.stopLabels.id} />
                <Layer {...clusters.count} afterId={clusters.bubble.id} />
                <Layer {...layers.marks} afterId={clusters.count.id} />
            </GeoJSONSource>
            <GeoJSONSource
                id={PINNED_SOURCE}
                data={markers.pinned}
                hitbox={{ top: HIT, right: HIT, bottom: HIT, left: HIT }}
                onPress={(event) =>
                    void onVehiclePress(event.nativeEvent.features[0])
                }
            >
                <Layer {...pinnedLayers.text} afterId={layers.marks.id} />
                <Layer {...pinnedLayers.marks} afterId={pinnedLayers.text.id} />
                <Layer {...pinnedLayers.ring} afterId={pinnedLayers.marks.id} />
                <Layer {...pinnedLayers.badge} afterId={pinnedLayers.ring.id} />
                <Layer {...pinnedLayers.chip} afterId={pinnedLayers.badge.id} />
            </GeoJSONSource>
        </MapLibreMap>
    );
}
