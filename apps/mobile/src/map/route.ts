import type { VehiclePositionWithDelay } from "@megisholavonat/api-client";
import { decodePolyline } from "@megisholavonat/core/polyline";
import { trainStop } from "../train/trainData";

// The selected train's route and stops for the map's focus mode.

const EMPTY: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [],
};

/** The trip's shape as a line ([lon, lat]); empty without geometry */
export function routeLine(
    details: Pick<VehiclePositionWithDelay, "trip"> | undefined,
): GeoJSON.FeatureCollection {
    const points = details?.trip.tripGeometry?.points;
    if (!points) return EMPTY;
    const coordinates = decodePolyline(points).map(
        ([lat, lon]): [number, number] => [lon, lat],
    );
    if (coordinates.length < 2) return EMPTY;
    return {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates },
            },
        ],
    };
}

/** The trip's stops with their names; `passed` once the train left them */
export function routeStops(
    details:
        | Pick<
              VehiclePositionWithDelay,
              "activity" | "dwellStopIndex" | "vehicleProgress" | "trip"
          >
        | undefined,
): GeoJSON.FeatureCollection<GeoJSON.Point, { name: string; passed: boolean }> {
    if (!details) return { type: "FeatureCollection", features: [] };
    const { next } = trainStop(details);
    return {
        type: "FeatureCollection",
        features: details.trip.stoptimes.map((st, index) => ({
            type: "Feature",
            properties: { name: st.stop.name, passed: index < next },
            geometry: {
                type: "Point",
                coordinates: [st.stop.lon, st.stop.lat],
            },
        })),
    };
}
