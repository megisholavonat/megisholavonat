// What a link preview shows, built from the API data. Pure: shared by the
// og:image routes and the page metadata.

import type {
    StationBoard,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";
import { type DelayLevel, getDelayLevel } from "@megisholavonat/core/delay";
import { decodePolyline } from "@megisholavonat/core/polyline";
import type {
    DepartureShareInfo,
    TrainShareInfo,
} from "@megisholavonat/core/share";
import { formatSecondsAsTime } from "@megisholavonat/core/time";
import { isStale } from "@megisholavonat/core/vehicle";
import {
    beforeDeparture,
    destinationOf,
    nextStopIndex,
    stopTiming,
    trainName,
    trainNumber,
} from "@/lib/train";

/** Route line in a unit box: x right, y down, both 0..1, aspect kept. */
export interface RouteSketch {
    /** Box aspect (width / height) the points were fitted into */
    aspect: number;
    passed: [number, number][];
    ahead: [number, number][];
    train: [number, number] | null;
    stops: [number, number][];
    /** First and last stop, for labels */
    ends: { name: string; at: [number, number] }[];
}

export interface TrainCard {
    number: string;
    name: string | null;
    /** MNR2007 glyph character(s) of the route */
    glyph: string | null;
    /** Glyph colour, "#C82227" */
    glyphColor: string;
    destination: string;
    delay: number;
    level: DelayLevel;
    stale: boolean;
    waiting: boolean;
    /** Next stop (the first stop while waiting) and its expected time */
    next: { name: string; time: string } | null;
    /** Share of the route already run, 0..1 */
    progress: number;
    sketch: RouteSketch | null;
}

export interface StationCard {
    name: string;
    departures: (DepartureShareInfo & {
        number: string;
        glyph: string | null;
        glyphColor: string;
        level: DelayLevel;
        platform: string | null;
    })[];
}

/** `<span class="MNR2007">&#473;</span>` -> U+01D9 (the glyph's character). */
export function glyphText(
    routeShortName: string | null | undefined,
): string | null {
    if (!routeShortName) return null;
    const text = routeShortName
        .replace(/<[^>]*>/g, "")
        .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
            String.fromCodePoint(Number.parseInt(hex, 16)),
        )
        .replace(/&#(\d+);/g, (_, dec: string) =>
            String.fromCodePoint(Number(dec)),
        )
        .trim();
    return text || null;
}

function hexColor(color: string | null | undefined, fallback: string): string {
    return color && /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : fallback;
}

const clock = new Intl.DateTimeFormat("hu-HU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Budapest",
});

/** "04:10" in Budapest time for unix seconds. */
export function formatClock(epochSeconds: number): string {
    return clock.format(new Date(epochSeconds * 1000));
}

const MAX_POINTS = 240;

/**
 * The trip geometry fitted into a box of `aspect`, split at the train.
 * Longitude is scaled by cos(latitude) so the shape looks like the map.
 */
export function routeSketch(
    vehicle: VehiclePositionWithDelay,
    aspect: number,
): RouteSketch | null {
    const encoded = vehicle.trip.tripGeometry?.points;
    let coords = encoded ? decodePolyline(encoded) : [];
    if (coords.length < 2) {
        coords = vehicle.trip.stoptimes.map(
            (s) => [s.stop.lat, s.stop.lon] as [number, number],
        );
    }
    if (coords.length < 2) return null;
    const step = Math.ceil(coords.length / MAX_POINTS);
    const thin = coords.filter(
        (_, i) => i % step === 0 || i === coords.length - 1,
    );

    const meanLat = thin.reduce((sum, [lat]) => sum + lat, 0) / thin.length;
    const kx = Math.cos((meanLat * Math.PI) / 180);
    const project = ([lat, lon]: [number, number]): [number, number] => [
        lon * kx,
        -lat,
    ];
    const pts = thin.map(project);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const w = Math.max(Math.max(...xs) - minX, 1e-6);
    const h = Math.max(Math.max(...ys) - minY, 1e-6);
    // Fit into the box, centred: unit square scaled to the aspect
    const scale = Math.min(aspect / w, 1 / h);
    const ox = (aspect - w * scale) / 2;
    const oy = (1 - h * scale) / 2;
    const toBox = ([x, y]: [number, number]): [number, number] => [
        (ox + (x - minX) * scale) / aspect,
        oy + (y - minY) * scale,
    ];
    const line = pts.map(toBox);

    const train =
        vehicle.lat != null && vehicle.lon != null
            ? toBox(project([vehicle.lat, vehicle.lon]))
            : null;
    let split = 0;
    if (train) {
        let best = Number.POSITIVE_INFINITY;
        line.forEach(([x, y], i) => {
            const d = (x - train[0]) ** 2 + (y - train[1]) ** 2;
            if (d < best) {
                best = d;
                split = i;
            }
        });
    }
    const stops = vehicle.trip.stoptimes.map((s) =>
        toBox(project([s.stop.lat, s.stop.lon])),
    );
    return {
        aspect,
        passed: train ? [...line.slice(0, split + 1), train] : [],
        ahead: train ? [train, ...line.slice(split + 1)] : line,
        train,
        stops,
        ends: [0, stops.length - 1].flatMap((i) => {
            const name = vehicle.trip.stoptimes[i]?.stop.name;
            const at = stops[i];
            return name && at ? [{ name, at }] : [];
        }),
    };
}

export function trainCard(
    vehicle: VehiclePositionWithDelay,
    now: Date = new Date(),
    sketchAspect = 1,
): TrainCard {
    const stoptimes = vehicle.trip.stoptimes;
    const waiting = beforeDeparture(vehicle, now);
    const nextIdx = waiting ? 0 : nextStopIndex(vehicle);
    const predicted = vehicle.processedStops?.find(
        (s, i) => (s.index ?? i) === nextIdx,
    )?.predictedDelay;
    const stoptime = stoptimes[nextIdx];
    const next = stoptime
        ? {
              name: stoptime.stop.name,
              time: formatSecondsAsTime(
                  stopTiming(stoptime, nextIdx, false, vehicle.delay, predicted)
                      .expected,
              ),
          }
        : null;
    const delay = Math.max(0, Math.round(vehicle.delay));
    const total = vehicle.totalRouteDistance;
    const progress = waiting
        ? 0
        : (vehicle.vehicleProgress?.progress ??
          (total ? vehicle.trainPosition / total : 0));
    return {
        number: trainNumber(vehicle.trip.tripShortName),
        name: trainName(vehicle.trip.tripShortName),
        glyph: glyphText(vehicle.trip.route.shortName),
        glyphColor: hexColor(vehicle.trip.route.textColor, "#14161A"),
        destination: destinationOf(vehicle),
        delay,
        level: getDelayLevel(delay),
        stale: isStale(vehicle, now),
        waiting,
        next,
        progress: Math.min(1, Math.max(0, progress)),
        sketch: routeSketch(vehicle, sketchAspect),
    };
}

export function trainShareInfo(card: TrainCard): TrainShareInfo {
    return {
        number: card.number,
        delay: card.delay,
        waiting: card.waiting,
        next: card.next,
    };
}

export function stationCard(board: StationBoard, limit = 4): StationCard {
    return {
        name: board.station.name,
        departures: board.entries.slice(0, limit).map((entry) => {
            const delay = Math.max(0, Math.round(entry.delayMinutes ?? 0));
            return {
                time: formatClock(entry.scheduledTime),
                headsign: entry.headsign ?? "",
                delay,
                canceled: !!entry.canceled,
                number: trainNumber(entry.tripShortName ?? ""),
                glyph: glyphText(entry.routeShortName),
                glyphColor: hexColor(entry.routeTextColor, "#14161A"),
                level: getDelayLevel(delay),
                platform: entry.platform ?? null,
            };
        }),
    };
}
