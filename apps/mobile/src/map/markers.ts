import type { TrainFeatureCollection } from "@megisholavonat/api-client";
import { type DelayLevel, getDelayLevel } from "@megisholavonat/core/delay";
import { minutesSinceUpdate, staleness } from "@megisholavonat/core/stale";
import { MARKER } from "@megisholavonat/core/tokens";
import type { NativeTheme } from "@megisholavonat/core/tokens/native";

// Map markers per "DS · Térképjelölő": colour + size + minutes. Each feature
// carries its resolved paint values, so the layers only read properties.
//
// MapLibre circle layers cannot draw stretchable pills, dashed outlines or
// the direction triangle, so at zoom ≥ 9 a marker is a circle sized to fit
// its "+N" label.

export interface MarkerProperties {
    vehicleId: string;
    fill: string;
    stroke: string;
    strokeWidth: number;
    /** Outer halo ring colour; "" for none */
    halo: string;
    /** Dot radius below the label zoom */
    dotRadius: number;
    /** Radius from the label zoom on, fitted to the label */
    pillRadius: number;
    label: string;
    labelColor: string;
    fontSize: number;
    /** Larger delays draw on top */
    sort: number;
}

const SORT: Record<DelayLevel, number> = {
    onTime: 1,
    slight: 2,
    moderate: 3,
    severe: 4,
};

/** Circle radius that fits `label` at `fontSize`, at least half the pill height. */
export function fittedRadius(
    label: string,
    fontSize: number,
    height: number,
): number {
    if (!label) return height / 2;
    const textWidth = label.length * fontSize * 0.6;
    return Math.max(height / 2, Math.round((textWidth / 2 + 3) * 2) / 2);
}

type MarkerTheme = Pick<NativeTheme, "delay" | "stale">;

export function markerCollection(
    trains: TrainFeatureCollection | undefined,
    theme: MarkerTheme,
    now: Date = new Date(),
): GeoJSON.FeatureCollection<GeoJSON.Point, MarkerProperties> {
    const features: GeoJSON.Feature<GeoJSON.Point, MarkerProperties>[] = [];
    for (const feature of trains?.features ?? []) {
        const p = feature.properties;
        const state = staleness(p.lastUpdated, now);
        if (state === "hidden") continue;

        let props: MarkerProperties;
        if (state === "stale" || p.isStale) {
            const spec = MARKER.stale;
            const label = MARKER.label.stale(
                minutesSinceUpdate(p.lastUpdated, now),
            );
            props = {
                vehicleId: p.vehicleId,
                fill: theme.stale.background,
                stroke: theme.stale.outline.color,
                strokeWidth: theme.stale.outline.width,
                halo: "",
                dotRadius: spec.dot / 2,
                pillRadius: fittedRadius(label, spec.fontSize, spec.height),
                label,
                labelColor: theme.stale.text,
                fontSize: spec.fontSize,
                sort: 0,
            };
        } else {
            const level = getDelayLevel(p.delay);
            const spec = MARKER.levels[level];
            const colors = theme.delay[level];
            const label =
                level === "onTime" ? "" : MARKER.label.delayed(p.delay);
            props = {
                vehicleId: p.vehicleId,
                fill: colors.fill,
                stroke: colors.outline.color,
                strokeWidth: colors.outline.width,
                halo: colors.outline.halo?.color ?? "",
                dotRadius: spec.dot / 2,
                pillRadius: fittedRadius(label, spec.fontSize, spec.height),
                label,
                labelColor: colors.label,
                fontSize: spec.fontSize,
                sort: SORT[level],
            };
        }
        features.push({
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [p.lon, p.lat],
            },
            properties: props,
        });
    }
    return { type: "FeatureCollection", features };
}
