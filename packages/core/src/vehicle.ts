import type { VehiclePositionWithDelay } from "@megisholavonat/api-client";
import * as turf from "@turf/turf";
import type { TrainActivity } from "./display";
import { decodePolyline } from "./polyline";
import { staleness } from "./stale";
import { getSecondsSinceDay, secondsIntoServiceDay } from "./time";

// The API ports isStale / trainActivity / isFarFromRoute as `activity` in the
// train list and details (apps/api/api/util/vehicle.py). Keep both in sync.
// Both read the clock through the service-date resolution in ./time.ts
// (`secondsIntoServiceDay`, ported from apps/api/api/util/trip.py).

/** Faster than this (m/s, about 7 km/h) near its terminus a train still runs. */
const MOVING_MPS = 2;

/** Every stop from the next one on is cancelled. */
function remainingCancelled(vehiclePosition: VehiclePositionWithDelay) {
    const stops = vehiclePosition.trip.stoptimes ?? [];
    const next = vehiclePosition.vehicleProgress?.nextStopIndex ?? 0;
    const ahead = stops.slice(next);
    const checked = ahead.length > 0 ? ahead : stops.slice(-1);
    return (
        checked.length > 0 &&
        checked.every((stop) => stop.realtimeState === "CANCELED")
    );
}

/**
 * What the train is doing by its position and schedule: running its trip,
 * cancelled, far off its route, waiting at its origin before departure, or
 * standing at its destination. Normally the API's `activity` is used; this
 * is its port for tests and data without it.
 */
export function trainActivity(
    vehiclePosition: VehiclePositionWithDelay,
    now: Date = new Date(),
): TrainActivity {
    const { lat, lon, trip } = vehiclePosition;
    const stops = trip.stoptimes;

    if (!stops || stops.length === 0) {
        return "running";
    }

    if (remainingCancelled(vehiclePosition)) {
        return "cancelled";
    }

    // Check if train is far from its designated route - if so, mark as inactive
    if (isFarFromRoute(vehiclePosition)) {
        return "offRoute";
    }

    const currentPosition = turf.point([lon, lat]);
    // The trip's `serviceDate` can be off by a day around midnight
    const currentTime = secondsIntoServiceDay(trip, now);

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
                return "beforeDeparture"; // At its origin, not left yet
            }
        }
    }

    // Near the destination and no longer moving. A train still pulling in at
    // speed is running: the last kilometre takes a minute or two.
    const lastStop = stops[stops.length - 1];
    const moving = (vehiclePosition.speed ?? 0) > MOVING_MPS;
    if (lastStop && !moving) {
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
            return "arrived";
        }
    }

    return "running";
}

/** Running its trip (see `trainActivity`). */
export function isActive(
    vehiclePosition: VehiclePositionWithDelay,
    now: Date = new Date(),
): boolean {
    return trainActivity(vehiclePosition, now) === "running";
}

/** Grey (stale) after STALE_GREY_AFTER_S without a position update. */
export function isStale(
    vehiclePosition: VehiclePositionWithDelay,
    now: Date = new Date(),
): boolean {
    return staleness(vehiclePosition.lastUpdated, now) !== "fresh";
}

export function dataAppearsFalsified(
    vehiclePosition: VehiclePositionWithDelay,
    isStale: boolean,
    now: Date = new Date(),
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

    // Case 2: Calculate scheduled delay vs our GPS-based delay.
    // Stoptimes count from Budapest midnight of the service date, not from
    // the device's local midnight.
    const secondsSinceMidnight = getSecondsSinceDay(
        vehiclePosition.trip.serviceDate,
        now,
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
    vehiclePosition: VehiclePositionWithDelay,
): boolean {
    const { lat, lon, trip } = vehiclePosition;

    // Check if we have a route geometry
    if (!trip.tripGeometry?.points) {
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
