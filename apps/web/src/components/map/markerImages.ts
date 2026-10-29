// Map marker sprites drawn from the design tokens ("DS · Térképjelölő"):
// colour + size + minutes, round for trains, square-ish for HÉV and with
// pointed ends for tram-trains.
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

/**
 * Colour level of a marker: a delay level, "stale" (hollow, dashed, with the
 * data's age) or "inactive" (waiting, arrived or off its route: a plain grey
 * dot without a delay, the old app's "No data / Inactive").
 */
export type MarkerLevel = DelayLevel | "stale" | "inactive";
export type MarkerShape = "train" | "hev" | "tramtrain";

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

/** Outline of the grey inactive dot: dark enough to read on the light map. */
const INACTIVE_OUTLINE: Record<ColorScheme, Outline> = {
    light: { color: STALE_COLORS.light.outline.color, width: 1.5 },
    dark: { color: COLORS.dark.map, width: 1.5 },
};

/** Fill and outline colour of a marker level (also for the z < 9 dots). */
export function levelColors(
    scheme: ColorScheme,
    level: MarkerLevel,
): { fill: string; outline: string } {
    const paint = paintOf(scheme, level);
    return { fill: paint.fill, outline: paint.outline.color };
}

function paintOf(scheme: ColorScheme, level: MarkerLevel): Paint {
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

function outlineExtent(outline: Outline): number {
    return Math.max(outline.width, outline.halo?.width ?? 0);
}

/** Depth of a tram-train's pointed ends, as a share of half its height. */
const POINT_SHARE = 0.75;

function pointDepth(w: number, h: number): number {
    return Math.min((h / 2) * POINT_SHARE, w / 2);
}

/** A rounded rectangle, or a hexagon with pointed ends for tram-trains. */
function bodyPath(
    ctx: CanvasRenderingContext2D,
    shape: MarkerShape,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
) {
    ctx.beginPath();
    if (shape === "tramtrain") {
        const p = pointDepth(w, h);
        ctx.moveTo(x + p, y);
        ctx.lineTo(x + w - p, y);
        ctx.lineTo(x + w, y + h / 2);
        ctx.lineTo(x + w - p, y + h);
        ctx.lineTo(x + p, y + h);
        ctx.lineTo(x, y + h / 2);
        ctx.closePath();
        return;
    }
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
    shape: MarkerShape,
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
    const ctx = context(canvas);
    if (!ctx) return { canvas, margin };
    ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
    const x = margin;
    const y = margin;

    const grow = (by: number, color: string) => {
        bodyPath(ctx, shape, x - by, y - by, w + by * 2, h + by * 2, r + by);
        ctx.fillStyle = color;
        ctx.fill();
    };

    if (selected) {
        const out = outlineExtent(paint.outline) + sel.gap + sel.ringWidth;
        bodyPath(
            ctx,
            shape,
            x - out,
            y - out,
            w + out * 2,
            h + out * 2,
            r + out,
        );
        ctx.fillStyle = COLORS[scheme].ink;
        ctx.fill();
        // The gap shows the map colour so the ring reads as separate
        grow(outlineExtent(paint.outline) + sel.gap, COLORS[scheme].map);
    }

    if (paint.dashed) {
        grow(0, paint.fill);
        const inset = paint.outline.width / 2;
        bodyPath(
            ctx,
            shape,
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

/**
 * A 2D context kept on the CPU: each sprite is read back once with
 * getImageData, which on a GPU canvas stalls for a readback.
 */
function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
    return canvas.getContext("2d", { willReadFrequently: true });
}

function toImage(canvas: HTMLCanvasElement): ImageData | null {
    const ctx = context(canvas);
    return ctx ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
}

function radiusFor(shape: MarkerShape, h: number): number {
    return shape === "hev" ? MARKER.radius.hev : h / 2;
}

/** Height of a marker per level: its pill, or the plain dot. */
export function pillHeight(level: MarkerLevel): number {
    if (level === "onTime" || level === "inactive") {
        return MARKER.levels.onTime.height;
    }
    return level === "stale"
        ? MARKER.stale.height
        : MARKER.levels[level].height;
}

/** Label font size per level. */
export function labelSize(level: MarkerLevel): number {
    return level === "stale" || level === "inactive"
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
    // Two rounded (or pointed) ends plus a stretchable middle
    const w = Math.max(r * 2, PILL_PADDING_X * 2) + STRETCH;
    // Keep the label clear of a tram-train's slanted ends
    const padX = Math.min(
        (w - STRETCH) / 2,
        shape === "tramtrain"
            ? Math.max(PILL_PADDING_X, pointDepth(w, h) + 2)
            : PILL_PADDING_X,
    );
    const { canvas, margin } = drawBody(
        scheme,
        level,
        shape,
        w,
        h,
        r,
        selected,
    );
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
            (margin + padX) * PIXEL_RATIO,
            (midY - textHeight / 2) * PIXEL_RATIO,
            (margin + w - padX) * PIXEL_RATIO,
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
    const { canvas } = drawBody(scheme, level, shape, size, size, r, selected);
    const data = toImage(canvas);
    return data ? { data, meta: { pixelRatio: PIXEL_RATIO } } : null;
}

/** Direction of travel: a small ink triangle pointing up (rotated by heading). */
function arrow(scheme: ColorScheme) {
    const { width, height } = MARKER.directionArrow;
    const canvas = document.createElement("canvas");
    canvas.width = (width + 2) * PIXEL_RATIO;
    canvas.height = (height + 2) * PIXEL_RATIO;
    const ctx = context(canvas);
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
    const ctx = context(canvas);
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
    const ctx = context(canvas);
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
    /^mhav-(light|dark)-(?:(dot|pill)-(onTime|slight|moderate|severe|stale|inactive)-(train|hev|tramtrain)(-sel)?|(arrow)|(station)|(follow))$/;

type Sprite = { data: ImageData; meta: Partial<StyleImageMetadata> };

/** Sprites drawn so far, by id: each is drawn once per page */
const sprites = new Map<string, Sprite | null>();

/** The sprite for one of our ids (drawn once, then cached), or null. */
export function markerImage(id: string): Sprite | null {
    let sprite = sprites.get(id);
    if (sprite === undefined) {
        sprite = drawSprite(id);
        sprites.set(id, sprite);
    }
    return sprite;
}

const LEVELS: MarkerLevel[] = [
    "onTime",
    "slight",
    "moderate",
    "severe",
    "stale",
    "inactive",
];
const SHAPES: MarkerShape[] = ["train", "hev", "tramtrain"];

/**
 * Every sprite id of a scheme, the likeliest first: what a selected train
 * needs, then plain trains, then the HÉV and tram-train shapes.
 */
export function markerImageIds(scheme: ColorScheme): string[] {
    const ids = [arrowImageId(scheme), followImageId(scheme)];
    for (const shape of SHAPES) {
        for (const selected of [true, false]) {
            for (const level of LEVELS) {
                for (const kind of ["pill", "dot"] as const) {
                    ids.push(
                        markerImageId(scheme, kind, level, shape, selected),
                    );
                }
            }
        }
    }
    ids.push(stationImageId(scheme));
    return ids;
}

interface ImageTarget {
    hasImage(id: string): boolean;
    addImage(
        id: string,
        data: ImageData,
        meta: Partial<StyleImageMetadata>,
    ): unknown;
}

/**
 * Draws and adds a scheme's sprites while the main thread is idle, a few at
 * a time, so selecting a train never waits on canvas work. Returns a cancel.
 */
export function prewarmMarkerImages(
    map: ImageTarget,
    scheme: ColorScheme,
): () => void {
    const queue = markerImageIds(scheme);
    const hasIdle = typeof requestIdleCallback === "function";
    let handle: ReturnType<typeof setTimeout> | number | null = null;
    const schedule = () => {
        handle = hasIdle
            ? requestIdleCallback(work, { timeout: 2000 })
            : setTimeout(
                  () => work({ didTimeout: false, timeRemaining: () => 8 }),
                  50,
              );
    };
    const work = (deadline: IdleDeadline) => {
        handle = null;
        while (queue.length && deadline.timeRemaining() > 3) {
            const id = queue.shift() as string;
            try {
                if (map.hasImage(id)) continue;
                const sprite = markerImage(id);
                if (sprite) map.addImage(id, sprite.data, sprite.meta);
            } catch {
                /* The style is being swapped; the resolver covers it */
            }
        }
        if (queue.length) schedule();
    };
    schedule();
    return () => {
        if (handle === null) return;
        if (hasIdle) cancelIdleCallback(handle as number);
        else clearTimeout(handle as ReturnType<typeof setTimeout>);
    };
}

function drawSprite(id: string): Sprite | null {
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
