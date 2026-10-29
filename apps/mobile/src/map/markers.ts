import type { TrainFeatureCollection } from "@megisholavonat/api-client";
import { delayLabel } from "@megisholavonat/core/display";
import { staleness } from "@megisholavonat/core/stale";
import {
    type ColorScheme,
    DELAY_SCALE,
    STALE_COLORS,
} from "@megisholavonat/core/tokens";
import { shownDisplay } from "../train/delayDisplay";
import {
    chipId,
    chipPaint,
    type MarkLevel,
    type MarkShape,
    markId,
    ringId,
} from "./sprites";

// Train marks: one size per zoom for every vehicle, colour is the delay band
// only, shape is the vehicle type. Each feature carries its sprite ids and
// texts, so the layers in mapStyle.ts only read properties.

/**
 * Shape by vehicle type (round train, square HÉV, pointed tram-train). Off:
 * every vehicle is round.
 */
export const VEHICLE_SHAPES = true;

export function markShape(type: string | undefined): MarkShape {
    if (!VEHICLE_SHAPES) return "train";
    return type === "hev" || type === "tramtrain" ? type : "train";
}

export interface MarkerProperties {
    vehicleId: string;
    /** For offsets that clear the mark */
    shape: MarkShape;
    /** Sprite of the mark */
    icon: string;
    /** Sprite of the selection ring around it */
    ring: string;
    /** Sprite of the "+N" chip ("" for none), selected and followed only */
    chip: string;
    /** The chip's text: "+N", or the last known "+N?" of old data */
    label: string;
    labelColor: string;
    /** "+N" beside an unselected late train ("+N?" for old data), from city zoom; "" for none */
    text: string;
    textColor: string;
    /** Minutes late, so the biggest delays get their number first */
    delay: number;
    /** Larger delays draw on top, followed trains above all */
    sort: number;
    /** A followed train: never faded, with an ink badge and its chip */
    followed: boolean;
}

const SORT: Record<MarkLevel, number> = {
    inactive: 0,
    stale: 0,
    onTime: 1,
    slight: 2,
    moderate: 3,
    severe: 4,
};

export function markerCollection(
    trains: TrainFeatureCollection | undefined,
    scheme: ColorScheme,
    now: Date = new Date(),
    followed: ReadonlySet<string> = new Set(),
): GeoJSON.FeatureCollection<GeoJSON.Point, MarkerProperties> {
    const features: GeoJSON.Feature<GeoJSON.Point, MarkerProperties>[] = [];
    for (const feature of trains?.features ?? []) {
        const p = feature.properties;
        if (staleness(p.lastUpdated, now) === "hidden") continue;
        // Same rule as the sheet (the open train's feature carries its dwell)
        const display = shownDisplay(p, now);
        const shape = markShape(p.type);

        let level: MarkLevel;
        let label = "";
        let text = "";
        let textColor = "";
        let delay = 0;
        if (display.level === "stale" || display.delay === null) {
            // Old data: hollow grey, its last delay with a "?" ("+23?"), as
            // on the web. A train waiting at a terminus, arrived or
            // cancelled has no delay: a grey mark without a number
            level = display.outdated ? "stale" : "inactive";
            if (display.state === "stale" && display.delay !== null) {
                label = delayLabel(display.delay, true).text ?? "";
                text = label;
                textColor = STALE_COLORS[scheme].text;
            }
        } else {
            level = display.level;
            if (level !== "onTime") {
                const shown = delayLabel(display.delay);
                delay = shown.minutes ?? 0;
                label = shown.text ?? "";
                text = label;
                textColor = DELAY_SCALE[scheme][level].text;
            }
        }
        const isFollowed = followed.has(p.vehicleId);
        features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [p.lon, p.lat] },
            properties: {
                vehicleId: p.vehicleId,
                shape,
                icon: markId(scheme, level, shape),
                ring: ringId(scheme, shape),
                chip: label ? chipId(scheme, level) : "",
                label,
                labelColor: label ? chipPaint(scheme, level).text : "",
                text,
                textColor,
                delay,
                sort: SORT[level] + (isFollowed ? 10 : 0),
                followed: isFollowed,
            },
        });
    }
    return { type: "FeatureCollection", features };
}
