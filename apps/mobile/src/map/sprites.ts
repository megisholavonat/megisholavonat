import type { DelayLevel } from "@megisholavonat/core/delay";
import {
    COLORS,
    type ColorScheme,
    DELAY_SCALE,
    MARKER,
    type Outline,
    STALE_COLORS,
} from "@megisholavonat/core/tokens";
import { MAP_MARKS } from "@megisholavonat/core/tokens/map";

// The train marks' sprites: their ids, shapes and paint, shared by the map
// layers and scripts/map-sprites.mjs, which draws them into assets/map/ as
// PNGs (MapLibre Native has no canvas: circle layers can't draw squares).
// Pure, so it runs under Node for the generator and the tests.

/** A mark's colour: the delay band, or grey for old data / not running */
export type MarkLevel = DelayLevel | "stale" | "inactive";
/** Round train, square HÉV, pointed tram-train */
export type MarkShape = "train" | "hev" | "tramtrain";

export const MARK_LEVELS: readonly MarkLevel[] = [
    "onTime",
    "slight",
    "moderate",
    "severe",
    "stale",
    "inactive",
];
export const MARK_SHAPES: readonly MarkShape[] = ["train", "hev", "tramtrain"];
export const SCHEMES: readonly ColorScheme[] = ["light", "dark"];
/** Levels with a "+N" or "6′" chip on the selected and followed trains */
export const CHIP_LEVELS: readonly MarkLevel[] = [
    "slight",
    "moderate",
    "severe",
    "stale",
];

export const markId = (s: ColorScheme, level: MarkLevel, shape: MarkShape) =>
    `mhav-${s}-${level}-${shape}`;
export const ringId = (s: ColorScheme, shape: MarkShape) =>
    `mhav-${s}-ring-${shape}`;
export const chipId = (s: ColorScheme, level: MarkLevel) =>
    `mhav-${s}-chip-${level}`;

/** Every sprite id, in a stable order */
export function spriteIds(): string[] {
    const ids: string[] = [];
    for (const s of SCHEMES) {
        for (const shape of MARK_SHAPES) {
            for (const level of MARK_LEVELS) ids.push(markId(s, level, shape));
            ids.push(ringId(s, shape));
        }
        for (const level of CHIP_LEVELS) ids.push(chipId(s, level));
    }
    return ids;
}

/** The sprites' reference diameter (css px): icon-size is size / this */
export const SPRITE_SIZE = MAP_MARKS.spriteSize;

/** Body size (css px) of a shape at the reference size, same optical weight */
export function bodySize(shape: MarkShape): { w: number; h: number } {
    const d = SPRITE_SIZE;
    if (shape === "hev")
        return { w: d * MAP_MARKS.hevSide, h: d * MAP_MARKS.hevSide };
    if (shape === "tramtrain") {
        return {
            w: d * MAP_MARKS.tramtrain.width,
            h: d * MAP_MARKS.tramtrain.height,
        };
    }
    return { w: d, h: d };
}

/** Corner radius of a HÉV square, as a share of its side */
export const HEV_CORNER = 0.25;
/** Depth of a tram-train's pointed ends, as a share of half its height */
export const TRAMTRAIN_POINT = 0.75;

/**
 * Transparent margin (css px) around every mark's body: room for the widest
 * outline (the light halo, 2.5) plus anti-aliasing. It is also the mark's
 * collision box, so the "+N" beside it keeps clear by this much.
 */
export const MARK_MARGIN = 3;

/** A mark sprite's size (css px, whole pixels) at the reference size */
export function markBox(shape: MarkShape): { w: number; h: number } {
    const body = bodySize(shape);
    return {
        w: Math.ceil(body.w + MARK_MARGIN * 2),
        h: Math.ceil(body.h + MARK_MARGIN * 2),
    };
}

export interface MarkPaint {
    fill: string;
    outline: Outline;
    /** Hollow with a dashed outline inside the body (old data) */
    dashed: boolean;
}

/** Outline of the grey not-running dot: dark enough on the light map */
const INACTIVE_OUTLINE: Record<ColorScheme, Outline> = {
    light: { color: STALE_COLORS.light.outline.color, width: 1.5 },
    dark: { color: COLORS.dark.map, width: 1.5 },
};

export function markPaint(scheme: ColorScheme, level: MarkLevel): MarkPaint {
    if (level === "inactive") {
        return {
            fill: STALE_COLORS[scheme].fill,
            outline: INACTIVE_OUTLINE[scheme],
            dashed: false,
        };
    }
    if (level === "stale") {
        const stale = STALE_COLORS[scheme];
        return {
            fill: stale.background,
            outline: { color: stale.outline.color, width: stale.outline.width },
            dashed: true,
        };
    }
    const colors = DELAY_SCALE[scheme][level];
    return { fill: colors.fill, outline: colors.outline, dashed: false };
}

/** How far a mark's outline rings reach beyond its body (css px) */
export function outlineExtent(paint: MarkPaint): number {
    if (paint.dashed) return 0;
    return Math.max(paint.outline.width, paint.outline.halo?.width ?? 0);
}

/** The widest outline of a scheme: where the selection ring's gap starts */
export function schemeExtent(scheme: ColorScheme): number {
    return Math.max(
        ...MARK_LEVELS.map((level) => outlineExtent(markPaint(scheme, level))),
    );
}

/** The selected train's ink ring, `gap` off the outline, in the map colour */
export const RING = {
    gap: MARKER.selected.gap,
    width: MARKER.selected.ringWidth,
} as const;

/** How far the selection ring reaches from a shape's centre, sideways */
export function ringReach(shape: MarkShape): number {
    const widest = Math.max(...SCHEMES.map(schemeExtent));
    return bodySize(shape).w / 2 + widest + RING.gap + RING.width;
}

/**
 * The "+N" chip of the selected and followed trains: a small rounded box
 * left of the mark, stretched around its text by icon-text-fit (sized for
 * two digits, so it hardly stretches; MapLibre RN's images take no stretch
 * zones).
 */
export const CHIP = {
    w: 26,
    h: 18,
    radius: 5,
    /** Transparent margin for the outline rings */
    margin: 3,
    /** Between the box and the mark's selection ring (px) */
    gap: 2,
    fontSize: 12,
    /** Room between the text and the box: [vertical, horizontal] */
    inset: [2, 5],
} as const;

/** icon-text-fit-padding [top, right, bottom, left]: inset plus margin */
export function chipFitPadding(): [number, number, number, number] {
    const [v, h] = CHIP.inset;
    const m = CHIP.margin;
    return [v + m, h + m, v + m, h + m];
}

export function chipPaint(
    scheme: ColorScheme,
    level: MarkLevel,
): { fill: string; outline: Outline; text: string } {
    if (level === "stale" || level === "inactive") {
        const stale = STALE_COLORS[scheme];
        return {
            fill: stale.background,
            outline: { color: stale.outline.color, width: stale.outline.width },
            text: stale.text,
        };
    }
    const colors = DELAY_SCALE[scheme][level];
    return { fill: colors.fill, outline: colors.outline, text: colors.label };
}
