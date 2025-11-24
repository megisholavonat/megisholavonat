import type { ApiResponse } from "@megisholavonat/api-client";
import * as turf from "@turf/turf";
import type { VehicleType } from "@/util/icon";
import { decodePolyline } from "@/util/polyline";
import { getSecondsSinceDay } from "@/util/time";

const STALENESS_THRESHOLD_MINUTES = 30; // Show as stale after 30 minutes
const REMOVAL_THRESHOLD_MINUTES = 120; // Remove entirely after 2 hours

export function isActive(vehiclePosition: ApiResponse["locations"][0]) {
    const { lat, lon, trip } = vehiclePosition;
    const stops = trip.stoptimes;

    if (!stops || stops.length === 0) {
        return true;
    }

    // Check if train is far from its designated route - if so, mark as inactive
    if (isFarFromRoute(vehiclePosition)) {
        return false;
    }

    const currentPosition = turf.point([lon, lat]);
    const currentTime = getSecondsSinceDay(trip.serviceDate);

    // Check if near departure station and before departure time
    const firstStop = stops[0];
    if (firstStop) {
        const departureStation = turf.point([
            firstStop.stop.lon,
            firstStop.stop.lat,
        ]);
        const distanceToFirstStop = turf.distance(
            currentPosition,
            departureStation,
            { units: "meters" },
        );

        // Consider "near" as within 1000m of the station
        if (distanceToFirstStop <= 1000) {
            const departureTime =
                firstStop.realtimeDeparture ?? firstStop.scheduledDeparture;
            if (currentTime < departureTime) {
                return false; // Train is at departure station but hasn't left yet
            }
        }
    }

    // Check if near destination station
    const lastStop = stops[stops.length - 1];
    if (lastStop) {
        const destinationStation = turf.point([
            lastStop.stop.lon,
            lastStop.stop.lat,
        ]);
        const distanceToLastStop = turf.distance(
            currentPosition,
            destinationStation,
            { units: "meters" },
        );

        if (distanceToLastStop <= 1000) {
            return false; // Train is near or at destination
        }
    }

    return true;
}

export function isStale(vehiclePosition: ApiResponse["locations"][0]): boolean {
    const now = Date.now() / 1000; // Current time in seconds
    const lastUpdated = vehiclePosition.lastUpdated;
    const minutesSinceUpdate = (now - lastUpdated) / 60;

    return minutesSinceUpdate > STALENESS_THRESHOLD_MINUTES;
}

export function shouldRemove(
    vehiclePosition: ApiResponse["locations"][0],
): boolean {
    const now = Date.now() / 1000; // Current time in seconds
    const lastUpdated = vehiclePosition.lastUpdated;
    const minutesSinceUpdate = (now - lastUpdated) / 60;

    return minutesSinceUpdate > REMOVAL_THRESHOLD_MINUTES;
}

export function dataAppearsFalsified(
    vehiclePosition: ApiResponse["locations"][0],
    isStale: boolean,
): boolean {
    if (isStale) return false;
    // Very small delays should not trigger falsified flags
    if (vehiclePosition.delay <= 2) {
        return false;
    }

    // Case 1: Realtime exists but equals scheduled everywhere -> suspicious if our delay is big
    const realtimeStops = vehiclePosition.trip.stoptimes.filter(
        (stoptime) =>
            stoptime.realtimeArrival != null ||
            stoptime.realtimeDeparture != null,
    );

    const allRealtimeMatch =
        realtimeStops.length > 0 &&
        realtimeStops.every((stoptime) => {
            const arrivalOk =
                stoptime.realtimeArrival == null ||
                stoptime.scheduledArrival == null ||
                stoptime.realtimeArrival === stoptime.scheduledArrival;
            const departureOk =
                stoptime.realtimeDeparture == null ||
                stoptime.scheduledDeparture == null ||
                stoptime.realtimeDeparture === stoptime.scheduledDeparture;
            return arrivalOk && departureOk;
        });

    if (allRealtimeMatch && vehiclePosition.delay > 5) {
        return true;
    }

    // Case 2: Calculate scheduled delay vs our GPS-based delay
    const currentTime = Math.floor(Date.now() / 1000);
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const secondsSinceMidnight = Math.floor(
        (currentTime * 1000 - todayMidnight.getTime()) / 1000,
    );

    // Find current or next stop with real-time data
    const relevantStop =
        vehiclePosition.trip.stoptimes.find(
            (stoptime) =>
                stoptime.realtimeArrival &&
                stoptime.realtimeArrival >= secondsSinceMidnight,
        ) ||
        vehiclePosition.trip.stoptimes.find(
            (stoptime) =>
                stoptime.realtimeDeparture &&
                stoptime.realtimeDeparture >= secondsSinceMidnight,
        );

    if (relevantStop) {
        const scheduledTime =
            relevantStop.scheduledArrival || relevantStop.scheduledDeparture;
        const realtimeTime =
            relevantStop.realtimeArrival || relevantStop.realtimeDeparture;

        if (scheduledTime && realtimeTime) {
            const scheduledDelayMinutes = Math.round(
                (realtimeTime - scheduledTime) / 60,
            );

            // Our delay > 10 min, and difference > 5 min
            if (scheduledDelayMinutes > 0 && vehiclePosition.delay > 10) {
                const delayDifference = Math.abs(
                    scheduledDelayMinutes - vehiclePosition.delay,
                );
                if (delayDifference > 5) {
                    return true;
                }
            }
        }
    }

    return false;
}

export function isFarFromRoute(
    vehiclePosition: ApiResponse["locations"][0],
): boolean {
    const { lat, lon, trip } = vehiclePosition;

    // Check if we have a route geometry
    if (!trip.tripGeometry || !trip.tripGeometry.points) {
        return false; // If no route geometry, can't determine if far from route
    }

    const currentPosition = turf.point([lon, lat]);
    const DISTANCE_THRESHOLD_KM = 2; // 2 kilometers from the designated route

    // Decode the polyline to get route coordinates
    const routeCoords = decodePolyline(trip.tripGeometry.points);

    if (!routeCoords || routeCoords.length < 2) {
        return false;
    }

    const geoJsonCoords = routeCoords
        .map(([latCoord, lngCoord]) => [lngCoord, latCoord])
        .filter(
            ([lng, lat]) =>
                typeof lng === "number" &&
                typeof lat === "number" &&
                !Number.isNaN(lng) &&
                !Number.isNaN(lat),
        );

    if (geoJsonCoords.length < 2) {
        return false; // Need at least 2 valid points to make a line
    }

    // For very long routes (>1000 points), simplify by sampling every Nth point
    const MAX_POINTS = 1000;
    const simplifiedCoords =
        geoJsonCoords.length > MAX_POINTS
            ? geoJsonCoords.filter(
                  (_, index) =>
                      index % Math.ceil(geoJsonCoords.length / MAX_POINTS) ===
                      0,
              )
            : geoJsonCoords;

    if (simplifiedCoords.length < 2) {
        return false;
    }

    try {
        const routeLine = turf.lineString(simplifiedCoords);

        // Quick bounding box check - if train is clearly outside route bounds,
        const bounds = turf.bbox(routeLine);
        const buffer = DISTANCE_THRESHOLD_KM / 111; // Rough conversion: 1 degree ≈ 111 km
        const isOutsideBounds =
            lon < bounds[0] - buffer ||
            lon > bounds[2] + buffer ||
            lat < bounds[1] - buffer ||
            lat > bounds[3] + buffer;

        if (isOutsideBounds) {
            return true;
        }

        const nearestPoint = turf.nearestPointOnLine(
            routeLine,
            currentPosition,
        );
        const distanceKm = turf.distance(currentPosition, nearestPoint, {
            units: "kilometers",
        });

        return distanceKm > DISTANCE_THRESHOLD_KM;
    } catch {
        return false;
    }
}

export function vehicleType(
    vehiclePosition: ApiResponse["locations"][0],
): VehicleType {
    if (vehiclePosition.trip.route.longName.startsWith("H")) {
        return "hev";
    } else if (vehiclePosition.trip.route.longName === "1") {
        return "tramtrain";
    }
    return "train";
}
