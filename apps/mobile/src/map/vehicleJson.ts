import type { Shown } from "@megisholavonat/core/vehicleMotion";

// The trains' GeoJSON for the native map, as a string: MapLibre RN sends a
// source's data over as JSON anyway. Each feature's JSON is kept until its
// train moves, so a frame re-serialises only the trains that moved (those in
// view), not the whole feed.

type PointFeature = GeoJSON.Feature<GeoJSON.Point, { vehicleId: string }>;

interface Cached {
    lon: number;
    lat: number;
    heading: number | undefined;
    json: string;
}

export type FeatureJsonCache = WeakMap<object, Cached>;

export function featureJsonCache(): FeatureJsonCache {
    return new WeakMap();
}

/**
 * The collection with each train where it is drawn (`shown`, from the
 * animation) or else where the feed puts it. A drawn train also takes the
 * heading it moves in.
 */
export function collectionJson(
    collection: GeoJSON.FeatureCollection<GeoJSON.Point, { vehicleId: string }>,
    shown: ReadonlyMap<string, Shown> | null,
    cache: FeatureJsonCache,
): string {
    const parts: string[] = [];
    for (const feature of collection.features) {
        parts.push(featureJson(feature, shown, cache));
    }
    return `{"type":"FeatureCollection","features":[${parts.join(",")}]}`;
}

function featureJson(
    feature: PointFeature,
    shown: ReadonlyMap<string, Shown> | null,
    cache: FeatureJsonCache,
): string {
    const at = shown?.get(feature.properties.vehicleId);
    const [lon, lat] = at ?? feature.geometry.coordinates;
    const heading = at?.[2];
    const cached = cache.get(feature);
    if (
        cached &&
        cached.lon === lon &&
        cached.lat === lat &&
        cached.heading === heading
    ) {
        return cached.json;
    }
    const json = JSON.stringify({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties:
            heading === undefined
                ? feature.properties
                : { ...feature.properties, heading },
    });
    cache.set(feature, { lon, lat, heading, json });
    return json;
}
