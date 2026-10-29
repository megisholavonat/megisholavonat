import type {
    TrainFeatureCollection,
    TrainFeatureProperties,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";

// A train's state and delay come from `trainDisplay` in
// @megisholavonat/core/display, the same rules as the web. This keeps the
// open train's map marker on the same data as its sheet.

/**
 * The map feed with one train brought up to date from its details, when
 * those are newer: the open train's marker then shows what its sheet shows
 * (the feed polls every minute, the details every 15 s). Returns the same
 * object when nothing changes.
 */
export function patchFeed(
    feed: TrainFeatureCollection | undefined,
    details: VehiclePositionWithDelay,
): TrainFeatureCollection | undefined {
    if (!feed) return feed;
    const index = feed.features.findIndex(
        (f) => f.properties.vehicleId === details.vehicleId,
    );
    const feature = feed.features[index];
    if (!feature || feature.properties.lastUpdated >= details.lastUpdated) {
        return feed;
    }
    const p = feature.properties;
    const properties: TrainFeatureProperties = {
        ...p,
        lat: details.lat,
        lon: details.lon,
        heading: details.heading ?? p.heading,
        speed: details.speed ?? p.speed,
        delay: details.delay,
        lastUpdated: details.lastUpdated,
        activity: details.activity ?? p.activity,
    };
    const features = [...feed.features];
    features[index] = {
        ...feature,
        geometry: {
            ...feature.geometry,
            coordinates: [details.lon, details.lat],
        },
        properties,
    };
    return { ...feed, features };
}
