// Map marker sprites drawn from the design tokens ("DS · Térképjelölő"):
// colour + size + minutes, round for trains and square-ish for HÉV.
//
// Images are generated on demand: layers reference ids like
// `mhav-dark-pill-severe-hev-sel`, and the map's missing-image resolver calls
// `markerImage(id)`. Stretchable pills grow to fit their "+N" label.

import type { DelayLevel } from "@megisholavonat/core/delay";
import {
    COLORS,
    type ColorScheme,
    DELAY_SCALE,
    MARKER,
    type Outline,
    STALE_COLORS,
} from "@megisholavonat/core/tokens";
import type { StyleImageMetadata } from "maplibre-gl";

export type MarkerLevel = DelayLevel | "stale";
export type MarkerShape = "train" | "hev";

const PIXEL_RATIO = 2;
const PREFIX = "mhav-";
/** Horizontal room around the label inside a pill */
export const PILL_PADDING_X = 7;
/** MapLibre's default text-line-height (em) */
const TEXT_LINE_HEIGHT = 1.2;
/** Width of the stretchable middle of a pill */
const STRETCH = 2;

export function markerImageId(
    scheme: ColorScheme,
    kind: "dot" | "pill",
    level: MarkerLevel,
    shape: MarkerShape,
    selected: boolean,
): string {
    return `${PREFIX}${scheme}-${kind}-${level}-${shape}${selected ? "-sel" : ""}`;
}

export function arrowImageId(scheme: ColorScheme): string {
    return `${PREFIX}${scheme}-arrow`;
}

export function stationImageId(scheme: ColorScheme): string {
    return `${PREFIX}${scheme}-station`;
}

export function followImageId(scheme: ColorScheme): string {
    return `${PREFIX}${scheme}-follow`;
}

/** Diameter of the followed-train star badge */
export const FOLLOW_BADGE_SIZE = 16;

interface Paint {
    fill: string;
    outline: Outline;
    dashed: boolean;
}

function paintOf(scheme: ColorScheme, level: MarkerLevel): Paint {
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

function outlineExtent(outline: Outline): number {
    return Math.max(outline.width, outline.halo?.width ?? 0);
}

function roundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2));
}

/**
 * Draws a marker body of `w`×`h` css px with corner radius `r`, with its
 * outline rings (box-shadow semantics: rings grow outwards) and an optional
 * selection ring, centred in a canvas. Returns the canvas and the margin
 * around the body.
 */
function drawBody(
    scheme: ColorScheme,
    level: MarkerLevel,
    w: number,
    h: number,
    r: number,
    selected: boolean,
): { canvas: HTMLCanvasElement; margin: number } {
    const paint = paintOf(scheme, level);
    const sel = MARKER.selected;
    const ring = selected ? sel.gap + sel.ringWidth : 0;
    const margin = Math.ceil(outlineExtent(paint.outline) + ring) + 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil((w + margin * 2) * PIXEL_RATIO);
    canvas.height = Math.ceil((h + margin * 2) * PIXEL_RATIO);
    const ctx = canvas.getContext("2d");
    if (!ctx) return { canvas, margin };
    ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
    const x = margin;
    const y = margin;

    const grow = (by: number, color: string) => {
        roundedRect(ctx, x - by, y - by, w + by * 2, h + by * 2, r + by);
        ctx.fillStyle = color;
        ctx.fill();
    };

    if (selected) {
        const out = outlineExtent(paint.outline) + sel.gap + sel.ringWidth;
        roundedRect(ctx, x - out, y - out, w + out * 2, h + out * 2, r + out);
        ctx.fillStyle = COLORS[scheme].ink;
        ctx.fill();
        // The gap shows the map colour so the ring reads as separate
        grow(outlineExtent(paint.outline) + sel.gap, COLORS[scheme].map);
    }

    if (paint.dashed) {
        grow(0, paint.fill);
        const inset = paint.outline.width / 2;
        roundedRect(
            ctx,
            x + inset,
            y + inset,
            w - inset * 2,
            h - inset * 2,
            r - inset,
        );
        ctx.setLineDash([2.5, 2]);
        ctx.lineWidth = paint.outline.width;
        ctx.strokeStyle = paint.outline.color;
        ctx.stroke();
    } else {
        const { halo } = paint.outline;
        if (halo) grow(halo.width, halo.color);
        grow(paint.outline.width, paint.outline.color);
        grow(0, paint.fill);
    }
    return { canvas, margin };
}

function toImage(canvas: HTMLCanvasElement): ImageData | null {
    const ctx = canvas.getContext("2d");
    return ctx ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
}

function radiusFor(shape: MarkerShape, h: number): number {
    return shape === "hev" ? MARKER.radius.hev : h / 2;
}

/** Height of a pill (labelled marker) per level. */
export function pillHeight(level: MarkerLevel): number {
    return level === "stale"
        ? MARKER.stale.height
        : MARKER.levels[level].height;
}

/** Label font size per level. */
export function labelSize(level: MarkerLevel): number {
    return level === "stale"
        ? MARKER.stale.fontSize
        : MARKER.levels[level].fontSize || MARKER.stale.fontSize;
}

function pill(
    scheme: ColorScheme,
    level: MarkerLevel,
    shape: MarkerShape,
    selected: boolean,
) {
    const h = pillHeight(level);
    const r = radiusFor(shape, h);
    // Two rounded ends plus a stretchable middle
    const w = Math.max(r * 2, PILL_PADDING_X * 2) + STRETCH;
    const { canvas, margin } = drawBody(scheme, level, w, h, r, selected);
    const data = toImage(canvas);
    if (!data) return null;
    const midX = margin + w / 2;
    const midY = margin + h / 2;
    // The content box is exactly as tall as MapLibre's text box (one line),
    // so with icon-text-fit "both" only the width grows with the label
    const textHeight = labelSize(level) * TEXT_LINE_HEIGHT;
    const meta: Partial<StyleImageMetadata> = {
        pixelRatio: PIXEL_RATIO,
        stretchX: [
            [
                (midX - STRETCH / 2) * PIXEL_RATIO,
                (midX + STRETCH / 2) * PIXEL_RATIO,
            ],
        ],
        stretchY: [
            [
                (midY - STRETCH / 2) * PIXEL_RATIO,
                (midY + STRETCH / 2) * PIXEL_RATIO,
            ],
        ],
        content: [
            (margin + PILL_PADDING_X) * PIXEL_RATIO,
            (midY - textHeight / 2) * PIXEL_RATIO,
            (margin + w - PILL_PADDING_X) * PIXEL_RATIO,
            (midY + textHeight / 2) * PIXEL_RATIO,
        ],
    };
    return { data, meta };
}

function dot(
    scheme: ColorScheme,
    level: MarkerLevel,
    shape: MarkerShape,
    selected: boolean,
) {
    const size = MARKER.levels.onTime.height;
    const r = shape === "hev" ? MARKER.radius.hevDot : size / 2;
    const { canvas } = drawBody(scheme, level, size, size, r, selected);
    const data = toImage(canvas);
    return data ? { data, meta: { pixelRatio: PIXEL_RATIO } } : null;
}

/** Direction of travel: a small ink triangle pointing up (rotated by heading). */
function arrow(scheme: ColorScheme) {
    const { width, height } = MARKER.directionArrow;
    const canvas = document.createElement("canvas");
    canvas.width = (width + 2) * PIXEL_RATIO;
    canvas.height = (height + 2) * PIXEL_RATIO;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
    ctx.beginPath();
    ctx.moveTo(1 + width / 2, 1);
    ctx.lineTo(1 + width, 1 + height);
    ctx.lineTo(1, 1 + height);
    ctx.closePath();
    ctx.lineJoin = "round";
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = COLORS[scheme].map;
    ctx.stroke();
    ctx.fillStyle = COLORS[scheme].ink;
    ctx.fill();
    const data = toImage(canvas);
    return data ? { data, meta: { pixelRatio: PIXEL_RATIO } } : null;
}

/** Selected station: a hollow ink ring. */
function station(scheme: ColorScheme) {
    const size = 28;
    const canvas = document.createElement("canvas");
    canvas.width = size * PIXEL_RATIO;
    canvas.height = size * PIXEL_RATIO;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
    const c = size / 2;
    ctx.beginPath();
    ctx.arc(c, c, 13, 0, Math.PI * 2);
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = COLORS[scheme].ink;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(c, c, 9, 0, Math.PI * 2);
    ctx.fillStyle = COLORS[scheme].surface;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS[scheme].ink;
    ctx.stroke();
    const data = toImage(canvas);
    return data ? { data, meta: { pixelRatio: PIXEL_RATIO } } : null;
}

/** Followed train: a small ink disc with a star, pinned to the marker. */
function follow(scheme: ColorScheme) {
    const ring = 1.5;
    const size = FOLLOW_BADGE_SIZE + ring * 2;
    const canvas = document.createElement("canvas");
    canvas.width = size * PIXEL_RATIO;
    canvas.height = size * PIXEL_RATIO;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
    const c = size / 2;
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.fillStyle = COLORS[scheme].surface;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(c, c, FOLLOW_BADGE_SIZE / 2, 0, Math.PI * 2);
    ctx.fillStyle = COLORS[scheme].ink;
    ctx.fill();
    // Five-pointed star
    const outer = 4.6;
    const inner = outer * 0.45;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const x = c + r * Math.cos(a);
        const y = c + 0.4 + r * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = COLORS[scheme].surface;
    ctx.fill();
    const data = toImage(canvas);
    return data ? { data, meta: { pixelRatio: PIXEL_RATIO } } : null;
}

const ID_PATTERN =
    /^mhav-(light|dark)-(?:(dot|pill)-(onTime|slight|moderate|severe|stale)-(train|hev)(-sel)?|(arrow)|(station)|(follow))$/;

/** Builds the sprite for one of our ids, or null for other ids. */
export function markerImage(
    id: string,
): { data: ImageData; meta: Partial<StyleImageMetadata> } | null {
    const match = ID_PATTERN.exec(id);
    if (!match) return null;
    const scheme = match[1] as ColorScheme;
    if (match[6]) return arrow(scheme);
    if (match[7]) return station(scheme);
    if (match[8]) return follow(scheme);
    const kind = match[2];
    const level = match[3] as MarkerLevel;
    const shape = match[4] as MarkerShape;
    const selected = !!match[5];
    return kind === "pill"
        ? pill(scheme, level, shape, selected)
        : dot(scheme, level, shape, selected);
}
