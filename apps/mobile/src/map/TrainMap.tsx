import {
    Camera,
    GeoJSONSource,
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
import { MAP_FOCUS } from "@megisholavonat/core/tokens/map";
import { useQuery } from "@tanstack/react-query";
import { type Ref, useMemo } from "react";
import { StyleSheet } from "react-native";
import { useLocale } from "use-intl";
import { API_URL, TILE_CACHE_URL } from "../config";
import { useAppTheme } from "../theme/ThemeProvider";
import { useReduceMotion } from "../ui/motion";
import {
    basemapAnchors,
    INITIAL_VIEW,
    MAX_BOUNDS,
    mapDataUrls,
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
const DATA_URLS = mapDataUrls(API_URL);

// Core types its style with a newer style-spec than MapLibre RN bundles; the
// JSON is the same
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
        () => stationLayers({ scheme, dim, fadeMs }),
        [scheme, dim, fadeMs],
    );
    const route = useMemo(() => routeLayers(scheme), [scheme]);
    const layers = useMemo(
        () => trainLayers({ scheme, selectedId }),
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

    const markers = useMemo(
        () => markerCollection(trains, scheme, now, new Set(followed)),
        [trains, scheme, now, followed],
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
                id={VEHICLES_SOURCE}
                data={markers}
                hitbox={{ top: HIT, right: HIT, bottom: HIT, left: HIT }}
                onPress={(event) => {
                    const vehicleId =
                        event.nativeEvent.features[0]?.properties?.vehicleId;
                    if (typeof vehicleId === "string") onTrainPress(vehicleId);
                }}
            >
                <Layer {...layers.text} afterId={route.stopLabels.id} />
                <Layer {...layers.marks} afterId={layers.text.id} />
                <Layer {...layers.ring} afterId={layers.marks.id} />
                <Layer {...layers.badge} afterId={layers.ring.id} />
                <Layer {...layers.chip} afterId={layers.badge.id} />
            </GeoJSONSource>
        </MapLibreMap>
    );
}
