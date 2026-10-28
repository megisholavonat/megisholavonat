import {
    Camera,
    GeoJSONSource,
    Layer,
    Map as MapLibreMap,
    RasterSource,
} from "@maplibre/maplibre-react-native";
import { getTrainsOptions } from "@megisholavonat/api-client/react-query";
import { POLL_INTERVAL_MS } from "@megisholavonat/core/constants";
import { useQuery } from "@tanstack/react-query";
import { StyleSheet, useColorScheme } from "react-native";
import { TILE_CACHE_URL } from "../config";
import {
    baseStyleUrl,
    INITIAL_VIEW,
    MAX_BOUNDS,
    RAILWAY_ATTRIBUTION,
    railwayPaint,
    railwayTileUrl,
    TRAIN_CIRCLE_PAINT,
} from "./mapStyle";

const EMPTY: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [],
};

export function TrainMap({
    onTrainPress,
}: {
    onTrainPress: (vehicleId: string) => void;
}) {
    const scheme = useColorScheme() === "dark" ? "dark" : "light";
    const { data: trains } = useQuery({
        ...getTrainsOptions(),
        refetchInterval: POLL_INTERVAL_MS,
    });

    return (
        <MapLibreMap
            style={StyleSheet.absoluteFill}
            mapStyle={baseStyleUrl(scheme)}
            attribution
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
            />
            <RasterSource
                id="railway-source"
                tiles={[railwayTileUrl(TILE_CACHE_URL)]}
                tileSize={256}
                attribution={RAILWAY_ATTRIBUTION}
            >
                <Layer
                    id="railway"
                    type="raster"
                    paint={railwayPaint(scheme)}
                />
            </RasterSource>
            <GeoJSONSource
                id="vehicles-source"
                data={
                    (trains as GeoJSON.FeatureCollection | undefined) ?? EMPTY
                }
                onPress={(event) => {
                    const vehicleId =
                        event.nativeEvent.features[0]?.properties?.vehicleId;
                    if (typeof vehicleId === "string") onTrainPress(vehicleId);
                }}
            >
                <Layer id="trains" type="circle" paint={TRAIN_CIRCLE_PAINT} />
            </GeoJSONSource>
        </MapLibreMap>
    );
}
