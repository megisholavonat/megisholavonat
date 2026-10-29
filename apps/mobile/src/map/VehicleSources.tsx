import {
    GeoJSONSource,
    type GeoJSONSourceRef,
    Layer,
    type LayerProps,
} from "@maplibre/maplibre-react-native";
import type {
    TrainFeatureCollection,
    TrainFeatureProperties,
} from "@megisholavonat/api-client";
import { TOUCH_TARGET } from "@megisholavonat/core/tokens";
import { MAP_MARKS } from "@megisholavonat/core/tokens/map";
import { type Ref, type RefObject, useMemo, useRef } from "react";
import { SelectedTrainLabel } from "./MapLabels";
import { PINNED_SOURCE, VEHICLES_SOURCE } from "./mapStyle";
import type { MarkerProperties } from "./markers";
import { type MapView, useVehicleMotion } from "./useVehicleMotion";
import { collectionJson, featureJsonCache } from "./vehicleJson";

const HIT = TOUCH_TARGET / 2;
const HITBOX = { top: HIT, right: HIT, bottom: HIT, left: HIT };
/** Trains still piled up this close in are not clustered (as on the web) */
export const CLUSTER_MAX_ZOOM = 15;

type Markers = GeoJSON.FeatureCollection<GeoJSON.Point, MarkerProperties>;
type PressEvent = { nativeEvent: { features: GeoJSON.Feature[] } };

/**
 * The trains' two sources, the clustered one and the selected and followed
 * trains', with their layers, and the selected train's label. On its own,
 * so the animation's frames re-render only this, not the whole map.
 */
export function VehicleSources({
    trains,
    base,
    pinned,
    baseLayers,
    pinnedLayers,
    selected,
    animate,
    reduceMotion,
    view,
    zoom,
    vehiclesRef,
    onPress,
}: {
    /** The feed, for the trackers */
    trains: TrainFeatureCollection | undefined;
    base: Markers;
    pinned: Markers;
    /** Each with its afterId; memoised by the caller */
    baseLayers: LayerProps[];
    pinnedLayers: LayerProps[];
    /** The open train's feed entry, for its label */
    selected: TrainFeatureProperties | null;
    animate: boolean;
    reduceMotion: boolean;
    view: RefObject<MapView>;
    /** For the label's distance from its train */
    zoom: number;
    vehiclesRef: Ref<GeoJSONSourceRef>;
    onPress: (event: PressEvent) => void;
}) {
    const { shown, version } = useVehicleMotion(trains, animate, view);
    const cache = useRef(featureJsonCache()).current;
    // biome-ignore lint/correctness/useExhaustiveDependencies: a frame bumps version, the positions are in `shown`
    const baseJson = useMemo(
        () => collectionJson(base, shown, cache),
        [base, shown, cache, version],
    );
    // biome-ignore lint/correctness/useExhaustiveDependencies: as above
    const pinnedJson = useMemo(
        () => collectionJson(pinned, shown, cache),
        [pinned, shown, cache, version],
    );

    const baseChildren = useMemo(
        () => baseLayers.map((layer) => <Layer key={layer.id} {...layer} />),
        [baseLayers],
    );
    const pinnedChildren = useMemo(
        () => pinnedLayers.map((layer) => <Layer key={layer.id} {...layer} />),
        [pinnedLayers],
    );

    const selectedAt: [number, number] | null = selected
        ? ((shown?.get(selected.vehicleId)?.slice(0, 2) as
              | [number, number]
              | undefined) ?? [selected.lon, selected.lat])
        : null;

    return (
        <>
            <GeoJSONSource
                ref={vehiclesRef}
                id={VEHICLES_SOURCE}
                data={baseJson}
                cluster
                clusterRadius={MAP_MARKS.clusterRadius}
                clusterMinPoints={MAP_MARKS.clusterMinPoints}
                clusterMaxZoom={CLUSTER_MAX_ZOOM}
                hitbox={HITBOX}
                onPress={onPress}
            >
                {baseChildren}
            </GeoJSONSource>
            <GeoJSONSource
                id={PINNED_SOURCE}
                data={pinnedJson}
                hitbox={HITBOX}
                onPress={onPress}
            >
                {pinnedChildren}
            </GeoJSONSource>
            {selected && selectedAt ? (
                <SelectedTrainLabel
                    train={selected}
                    lngLat={selectedAt}
                    zoom={zoom}
                    reduceMotion={reduceMotion}
                />
            ) : null}
        </>
    );
}
