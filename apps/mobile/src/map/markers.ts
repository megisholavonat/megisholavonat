import type { TrainFeatureCollection } from "@megisholavonat/api-client";
import type { DelayLevel } from "@megisholavonat/core/delay";
import { staleness } from "@megisholavonat/core/stale";
import { MARKER } from "@megisholavonat/core/tokens";
import type { NativeTheme } from "@megisholavonat/core/tokens/native";
import { shownDisplay } from "../train/delayDisplay";

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
    /** Larger delays draw on top, followed trains above all */
    sort: number;
    /** A followed train: never faded, with an ink badge */
    followed: boolean;
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
    followed: ReadonlySet<string> = new Set(),
): GeoJSON.FeatureCollection<GeoJSON.Point, MarkerProperties> {
    const features: GeoJSON.Feature<GeoJSON.Point, MarkerProperties>[] = [];
    for (const feature of trains?.features ?? []) {
        const p = feature.properties;
        if (staleness(p.lastUpdated, now) === "hidden") continue;
        // Same rule as the sheet (the open train's feature carries its dwell)
        const display = shownDisplay(p, now);

        let props: Omit<MarkerProperties, "followed">;
        if (display.level === "stale" || display.delay === null) {
            // Old data: hollow grey with its age ("6′"). A train waiting at
            // a terminus or arrived has fresh data: a solid grey dot without
            // a label, so it doesn't read as "no data for 0 minutes"
            const spec = MARKER.stale;
            const label = display.outdated
                ? MARKER.label.stale(display.minutesSinceUpdate)
                : "";
            props = {
                vehicleId: p.vehicleId,
                fill: display.outdated
                    ? theme.stale.background
                    : theme.stale.fill,
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
            const level = display.level;
            const spec = MARKER.levels[level];
            const colors = theme.delay[level];
            const label =
                level === "onTime" ? "" : MARKER.label.delayed(display.delay);
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
            properties: followed.has(p.vehicleId)
                ? { ...props, followed: true, sort: props.sort + 10 }
                : { ...props, followed: false },
        });
    }
    return { type: "FeatureCollection", features };
}
