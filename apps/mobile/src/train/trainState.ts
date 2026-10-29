import type {
    TrainFeatureCollection,
    TrainFeatureProperties,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";

// A train's state and delay come from `trainDisplay` in
// @megisholavonat/core/display, the same rules as the web. This keeps the
// open train's map marker on the same data as its sheet.

/** A feed train, plus the stop it stands at once its details said so. */
export type PatchedProperties = TrainFeatureProperties & {
    dwellStopIndex?: number | null;
};

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
    if (!feature) return feed;
    const p: PatchedProperties = feature.properties;
    // The list has no dwell: same-age details still bring theirs, so the
    // marker and the sheet clamp an early train standing at a stop alike
    const dwell = details.dwellStopIndex ?? null;
    if (
        p.lastUpdated > details.lastUpdated ||
        (p.lastUpdated === details.lastUpdated &&
            (p.dwellStopIndex ?? null) === dwell)
    ) {
        return feed;
    }
    const properties: PatchedProperties = {
        dwellStopIndex: dwell,
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
