// What a link preview shows, built from the API data. Pure: shared by the
// og:image routes and the page metadata.

import type {
    StationBoard,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";
import {
    type DelayLevel,
    getDelayLevel,
    roundMinutes,
} from "@megisholavonat/core/delay";
import { type TrainDisplay, trainDisplay } from "@megisholavonat/core/display";
import { decodePolyline } from "@megisholavonat/core/polyline";
import {
    type DepartureShareInfo,
    type TrainShareInfo,
    type TrainShareStatus,
    trainShareStatus,
} from "@megisholavonat/core/share";
import { formatSecondsAsTime } from "@megisholavonat/core/time";
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
    destination: string;
    /** Minutes late; 0 unless running */
    delay: number;
    level: DelayLevel;
    /** As the map and sheet show it (core trainDisplay) */
    status: TrainShareStatus;
    /** No fresh data: the last delay is not told */
    stale: boolean;
    waiting: boolean;
    /**
     * Next stop (the first stop while waiting) and its expected time; a
     * forecast is `estimated` ("≈"), as in the sheet
     */
    next: { name: string; time: string; estimated: boolean } | null;
    /** Share of the route already run, 0..1 */
    progress: number;
    sketch: RouteSketch | null;
}

export interface StationCard {
    name: string;
    departures: (DepartureShareInfo & {
        number: string;
        glyph: string | null;
        /** Null without a live delay: no chip, as on the board */
        level: DelayLevel | null;
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

/**
 * What a shared train is doing, by the display the map and sheet use. Data
 * without `activity` (older APIs) tells a waiting train by its schedule.
 */
export function shareStatus(
    vehicle: VehiclePositionWithDelay,
    display: TrainDisplay,
    now: Date = new Date(),
): TrainShareStatus {
    const status = trainShareStatus(display);
    return status === "running" &&
        display.activity == null &&
        beforeDeparture(vehicle, now)
        ? "waiting"
        : status;
}

export function trainCard(
    vehicle: VehiclePositionWithDelay,
    now: Date = new Date(),
    sketchAspect = 1,
): TrainCard {
    const stoptimes = vehicle.trip.stoptimes;
    // The same state and delay as the train's marker and sheet
    const display = trainDisplay(vehicle, now);
    const status = shareStatus(vehicle, display, now);
    const waiting = status === "waiting";
    const running = status === "running";
    const nextIdx = waiting ? 0 : nextStopIndex(vehicle);
    const predicted = vehicle.processedStops?.find(
        (s, i) => (s.index ?? i) === nextIdx,
    )?.predictedDelay;
    const stoptime = stoptimes[nextIdx];
    // The sheet's own timing: the expected time that goes with the delay
    const timing =
        stoptime && (running || waiting)
            ? stopTiming(
                  stoptime,
                  nextIdx,
                  false,
                  running ? (display.delay ?? 0) : 0,
                  running ? predicted : undefined,
                  nextIdx === stoptimes.length - 1,
              )
            : null;
    const next =
        stoptime && timing
            ? {
                  name: stoptime.stop.name,
                  time: formatSecondsAsTime(timing.expected),
                  estimated: timing.estimated,
              }
            : null;
    const delay = running ? Math.max(0, roundMinutes(display.delay ?? 0)) : 0;
    const total = vehicle.totalRouteDistance;
    const progress = waiting
        ? 0
        : (vehicle.vehicleProgress?.progress ??
          (total ? vehicle.trainPosition / total : 0));
    return {
        number: trainNumber(vehicle.trip.tripShortName),
        name: trainName(vehicle.trip.tripShortName),
        glyph: glyphText(vehicle.trip.route.shortName),
        destination: destinationOf(vehicle),
        delay,
        level: getDelayLevel(delay),
        status,
        stale: status === "noData",
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
        status: card.status,
        next: card.next,
    };
}

/**
 * The delay a departure row tells, by the board's rule: only a live one,
 * and for a train still due to leave only when it is late ("pontos" would
 * claim it is already running).
 */
export function departureDelay(
    entry: StationBoard["entries"][number],
    now: Date,
): number | null {
    if (entry.canceled) return null;
    if (!entry.realtime && entry.delaySource !== "gps") return null;
    const delay = Math.max(0, roundMinutes(entry.delayMinutes ?? 0));
    const ahead = entry.scheduledTime * 1000 > now.getTime();
    if (ahead && delay <= 0) return null;
    return delay;
}

export function stationCard(
    board: StationBoard,
    now: Date = new Date(),
    limit = 4,
): StationCard {
    return {
        name: board.station.name,
        departures: board.entries.slice(0, limit).map((entry) => {
            const delay = departureDelay(entry, now);
            return {
                time: formatClock(entry.scheduledTime),
                headsign: entry.headsign ?? "",
                delay,
                canceled: !!entry.canceled,
                number: trainNumber(entry.tripShortName ?? ""),
                glyph: glyphText(entry.routeShortName),
                level: delay === null ? null : getDelayLevel(delay),
                platform: entry.platform ?? null,
            };
        }),
    };
}
