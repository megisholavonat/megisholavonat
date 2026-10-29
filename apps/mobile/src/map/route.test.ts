import type { VehiclePositionWithDelay } from "@megisholavonat/api-client";
import { describe, expect, it } from "vitest";
import { routeLine, routeStops } from "./route";

// "_p~iF~ps|U_ulLnnqC_mqNvxq`@": the polyline algorithm's own example
const details = {
    activity: "running",
    dwellStopIndex: null,
    vehicleProgress: { nextStopIndex: 1 },
    trip: {
        tripGeometry: { points: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
        stoptimes: [
            { stop: { name: "A", lat: 38.5, lon: -120.2 } },
            { stop: { name: "B", lat: 40.7, lon: -120.95 } },
        ],
    },
} as unknown as VehiclePositionWithDelay;

describe("route", () => {
    it("draws the trip's shape as lon/lat", () => {
        const line = routeLine(details).features[0]?.geometry;
        expect(line).toEqual({
            type: "LineString",
            coordinates: [
                [-120.2, 38.5],
                [-120.95, 40.7],
                [-126.453, 43.252],
            ],
        });
    });

    it("draws nothing without a train or geometry", () => {
        expect(routeLine(undefined).features).toEqual([]);
        expect(routeStops(undefined).features).toEqual([]);
    });

    it("marks the stops the train has left", () => {
        expect(routeStops(details).features.map((f) => f.properties)).toEqual([
            { name: "A", passed: true },
            { name: "B", passed: false },
        ]);
    });
});
