import {
    Camera,
    GeoJSONSource,
    Layer,
    Map as MapLibreMap,
    type MapRef,
    RasterSource,
    type TrackUserLocation,
    UserLocation,
} from "@maplibre/maplibre-react-native";
import type { TrainFeatureCollection } from "@megisholavonat/api-client";
import { TOUCH_TARGET } from "@megisholavonat/core/tokens";
import { type Ref, useMemo } from "react";
import { StyleSheet } from "react-native";
import { TILE_CACHE_URL } from "../config";
import { useAppTheme } from "../theme/ThemeProvider";
import {
    baseStyleUrl,
    FOLLOWED_FILTER,
    followedBadgePaint,
    HALO_FILTER,
    haloPaint,
    INITIAL_VIEW,
    LABEL_LAYOUT,
    LABEL_MIN_ZOOM,
    labelPaint,
    MARKER_LAYOUT,
    MAX_BOUNDS,
    markerPaint,
    RAILWAY_ATTRIBUTION,
    railwayPaint,
    railwayTileUrl,
    selectedRingPaint,
} from "./mapStyle";
import { markerCollection } from "./markers";
import { useSelectedTrain } from "./selection";

const HIT = TOUCH_TARGET / 2;

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
    const selectedId = useSelectedTrain();

    const markers = useMemo(
        () => markerCollection(trains, theme, now, new Set(followed)),
        [trains, theme, now, followed],
    );

    const trackUserLocation: TrackUserLocation | undefined = followUser
        ? "default"
        : undefined;

    return (
        <MapLibreMap
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            mapStyle={baseStyleUrl(scheme)}
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
                        // Under the trains also when switched on later or
                        // re-added after a theme's style reload (web BL-1)
                        beforeId="train-halo"
                        paint={railwayPaint(scheme)}
                    />
                </RasterSource>
            ) : null}
            {followUser ? <UserLocation /> : null}
            <GeoJSONSource
                id="vehicles-source"
                data={markers}
                hitbox={{ top: HIT, right: HIT, bottom: HIT, left: HIT }}
                onPress={(event) => {
                    const vehicleId =
                        event.nativeEvent.features[0]?.properties?.vehicleId;
                    if (typeof vehicleId === "string") onTrainPress(vehicleId);
                }}
            >
                <Layer
                    id="train-halo"
                    type="circle"
                    filter={HALO_FILTER}
                    layout={MARKER_LAYOUT}
                    paint={haloPaint(selectedId)}
                />
                <Layer
                    id="trains"
                    type="circle"
                    layout={MARKER_LAYOUT}
                    paint={markerPaint(selectedId)}
                />
                <Layer
                    id="train-labels"
                    type="symbol"
                    minzoom={LABEL_MIN_ZOOM}
                    layout={LABEL_LAYOUT}
                    paint={labelPaint(selectedId)}
                />
                <Layer
                    id="train-followed"
                    type="circle"
                    filter={FOLLOWED_FILTER}
                    layout={MARKER_LAYOUT}
                    paint={followedBadgePaint(
                        theme.colors.ink,
                        theme.colors.surface,
                    )}
                />
                <Layer
                    id="train-selected"
                    type="circle"
                    filter={["==", ["get", "vehicleId"], selectedId ?? ""]}
                    paint={selectedRingPaint(theme.colors.ink)}
                />
            </GeoJSONSource>
        </MapLibreMap>
    );
}
