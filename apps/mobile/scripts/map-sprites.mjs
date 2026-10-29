// Draws the map's train mark sprites from the design tokens into
// assets/map/*.png (@1x, @2x, @3x) and writes src/map/spriteImages.ts, the
// require() table the map hands to MapLibre. No dependencies: shapes are
// signed distance functions, sampled 4×4 per pixel, written as plain PNGs.
//
//   pnpm sprites           (node scripts/map-sprites.mjs)
//   node scripts/map-sprites.mjs --check   (part of `pnpm check`)
//
// Re-run after changing the marker tokens or src/map/sprites.ts.

import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

// The tokens are TypeScript with extensionless imports: let Node find them
registerHooks({
    resolve(specifier, context, next) {
        try {
            return next(specifier, context);
        } catch (error) {
            if (!specifier.startsWith(".")) throw error;
            return next(`${specifier}.ts`, context);
        }
    },
});

const sprites = await import("../src/map/sprites.ts");
const { COLORS } = await import("@megisholavonat/core/tokens");
const { MAP_FOLLOW_STAR, MAP_STATION_MARK } = await import(
    "@megisholavonat/core/tokens/map"
);
const {
    ARROW,
    FOLLOW_SIZE,
    STATION_SIZE,
    arrowId,
    followId,
    stationId,
    CHIP,
    CHIP_LEVELS,
    HEV_CORNER,
    MARK_LEVELS,
    MARK_MARGIN,
    MARK_SHAPES,
    RING,
    SCHEMES,
    TRAMTRAIN_POINT,
    bodySize,
    chipId,
    chipPaint,
    markBox,
    markId,
    markPaint,
    outlineExtent,
    ringId,
    schemeExtent,
    spriteIds,
} = sprites;

const SCALES = [1, 2, 3];
const SAMPLES = 4;
/** Stale outline dash and gap (css px), as on the web */
const DASH = [2.5, 2];

const root = new URL("../", import.meta.url);
const outDir = fileURLToPath(new URL("assets/map/", root));
const tableFile = fileURLToPath(new URL("src/map/spriteImages.ts", root));

// --- colours -------------------------------------------------------------

function parseColor(color) {
    const hex = /^#([0-9a-f]{6})$/i.exec(color);
    if (hex) {
        const n = Number.parseInt(hex[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
    }
    const rgba = /^rgba?\(([^)]+)\)$/i.exec(color);
    if (rgba) {
        const [r, g, b, a = 1] = rgba[1].split(",").map(Number);
        return [r, g, b, a];
    }
    throw new Error(`Unknown colour ${color}`);
}

// --- shapes: signed distance (css px) from the body's edge -----------------

function roundRect(hw, hh, r) {
    return (x, y) => {
        const qx = Math.abs(x) - (hw - r);
        const qy = Math.abs(y) - (hh - r);
        const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
        return outside + Math.min(Math.max(qx, qy), 0) - r;
    };
}

/** A convex polygon's (mitred) distance: the largest edge distance */
function polygon(points) {
    const edges = points.map(([x1, y1], i) => {
        const [x2, y2] = points[(i + 1) % points.length];
        const len = Math.hypot(x2 - x1, y2 - y1);
        // Outward normal of a clockwise (screen) polygon
        return { nx: (y2 - y1) / len, ny: -(x2 - x1) / len, x1, y1 };
    });
    return (x, y) =>
        Math.max(...edges.map((e) => (x - e.x1) * e.nx + (y - e.y1) * e.ny));
}

function shapeSdf(shape, w, h) {
    if (shape === "train") return roundRect(w / 2, h / 2, Math.min(w, h) / 2);
    if (shape === "hev") return roundRect(w / 2, h / 2, w * HEV_CORNER);
    // Tram-train: a hexagon with pointed ends
    const p = Math.min((h / 2) * TRAMTRAIN_POINT, w / 2);
    const hw = w / 2;
    const hh = h / 2;
    return polygon([
        [-hw + p, -hh],
        [hw - p, -hh],
        [hw, 0],
        [hw - p, hh],
        [-hw + p, hh],
        [-hw, 0],
    ]);
}

// --- raster ---------------------------------------------------------------

/**
 * Renders `w`×`h` css px at `scale`: `paint(x, y)` returns the [r, g, b, a]
 * at a point (css px from the centre) or null, sampled SAMPLES² per pixel.
 */
function render(w, h, scale, paint) {
    const pw = Math.round(w * scale);
    const ph = Math.round(h * scale);
    const data = Buffer.alloc(pw * ph * 4);
    for (let py = 0; py < ph; py++) {
        for (let px = 0; px < pw; px++) {
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            for (let sy = 0; sy < SAMPLES; sy++) {
                for (let sx = 0; sx < SAMPLES; sx++) {
                    const x = (px + (sx + 0.5) / SAMPLES) / scale - w / 2;
                    const y = (py + (sy + 0.5) / SAMPLES) / scale - h / 2;
                    const c = paint(x, y);
                    if (!c) continue;
                    // Premultiplied, averaged over the samples
                    r += c[0] * c[3];
                    g += c[1] * c[3];
                    b += c[2] * c[3];
                    a += c[3];
                }
            }
            const i = (py * pw + px) * 4;
            if (a > 0) {
                data[i] = Math.round(r / a);
                data[i + 1] = Math.round(g / a);
                data[i + 2] = Math.round(b / a);
                data[i + 3] = Math.round((a / SAMPLES ** 2) * 255);
            }
        }
    }
    return { pw, ph, data };
}

/** Topmost first: the first layer that covers the point wins. */
function over(layers) {
    return (x, y) => {
        let out = null;
        for (const layer of layers) {
            if (!layer.covers(x, y)) continue;
            const c = layer.color;
            if (!out) {
                out = [...c];
                if (out[3] >= 1) return out;
                continue;
            }
            // `out` is above `c`: composite it over `c`
            const a = out[3] + c[3] * (1 - out[3]);
            const mix = (i) =>
                (out[i] * out[3] + c[i] * c[3] * (1 - out[3])) / a;
            out = [mix(0), mix(1), mix(2), a];
            if (a >= 1) return out;
        }
        return out;
    };
}

// --- PNG ------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

function crc32(buffer) {
    let c = 0xffffffff;
    for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

function png({ pw, ph, data }) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(pw, 0);
    header.writeUInt32BE(ph, 4);
    header[8] = 8; // bit depth
    header[9] = 6; // RGBA
    const rows = Buffer.alloc((pw * 4 + 1) * ph);
    for (let y = 0; y < ph; y++) {
        data.copy(rows, y * (pw * 4 + 1) + 1, y * pw * 4, (y + 1) * pw * 4);
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", header),
        chunk("IDAT", deflateSync(rows, { level: 9 })),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

// Header and raw rows of a PNG this script wrote. Deflate output differs
// between zlib builds, so --check compares these instead of the file bytes.
function decode(file) {
    const parts = { IHDR: [], IDAT: [] };
    for (let at = 8; at < file.length; ) {
        const length = file.readUInt32BE(at);
        const type = file.toString("ascii", at + 4, at + 8);
        parts[type]?.push(file.subarray(at + 8, at + 8 + length));
        at += 12 + length;
    }
    return {
        header: Buffer.concat(parts.IHDR),
        rows: inflateSync(Buffer.concat(parts.IDAT)),
    };
}

// Same size and every channel within 1, which absorbs float differences
// between Node versions in the antialiased edges
function samePixels(a, b) {
    const x = decode(a);
    const y = decode(b);
    if (!x.header.equals(y.header) || x.rows.length !== y.rows.length) {
        return false;
    }
    return x.rows.every((value, i) => Math.abs(value - y.rows[i]) <= 1);
}

// --- sprites --------------------------------------------------------------

/** A train mark: halo, outline and fill, or hollow with a dashed outline. */
function mark(scheme, level, shape) {
    const body = bodySize(shape);
    const box = markBox(shape);
    const sdf = shapeSdf(shape, body.w, body.h);
    const paint = markPaint(scheme, level);
    const fill = parseColor(paint.fill);
    const line = parseColor(paint.outline.color);
    const layers = [];
    if (paint.dashed) {
        const width = paint.outline.width;
        // Dashes go round by angle: close enough on these small shapes
        const perimeter =
            shape === "train" ? Math.PI * body.w : 1.8 * (body.w + body.h);
        const dashes = Math.max(4, Math.round(perimeter / (DASH[0] + DASH[1])));
        const on = DASH[0] / (DASH[0] + DASH[1]);
        layers.push({
            color: line,
            covers: (x, y) => {
                const d = sdf(x, y);
                if (d >= 0 || d < -width) return false;
                const t = (Math.atan2(y, x) / (2 * Math.PI) + 1.25) * dashes;
                return t - Math.floor(t) < on;
            },
        });
        layers.push({ color: fill, covers: (x, y) => sdf(x, y) < 0 });
    } else {
        layers.push({ color: fill, covers: (x, y) => sdf(x, y) < 0 });
        layers.push({
            color: line,
            covers: (x, y) => sdf(x, y) < paint.outline.width,
        });
        const { halo } = paint.outline;
        if (halo) {
            layers.push({
                color: parseColor(halo.color),
                covers: (x, y) => sdf(x, y) < halo.width,
            });
        }
    }
    if (outlineExtent(paint) > MARK_MARGIN - 0.5) {
        throw new Error(`${level}: outline wider than the sprite margin`);
    }
    return { w: box.w, h: box.h, paint: over(layers) };
}

/** The selected train's ink ring, with a map-coloured gap inside it. */
function ring(scheme, shape) {
    const body = bodySize(shape);
    const sdf = shapeSdf(shape, body.w, body.h);
    const inner = schemeExtent(scheme) + RING.gap;
    const outer = inner + RING.width;
    const map = parseColor(COLORS[scheme].map);
    const ink = parseColor(COLORS[scheme].ink);
    const reach = Math.ceil(outer + 1);
    const w = Math.ceil(body.w + reach * 2);
    const h = Math.ceil(body.h + reach * 2);
    const gapFrom = schemeExtent(scheme);
    return {
        w,
        h,
        paint: over([
            {
                color: ink,
                covers: (x, y) => {
                    const d = sdf(x, y);
                    return d >= inner && d < outer;
                },
            },
            {
                color: map,
                covers: (x, y) => {
                    const d = sdf(x, y);
                    return d >= gapFrom && d < inner;
                },
            },
        ]),
    };
}

/** The "+N" chip's box, stretched around the text by icon-text-fit. */
function chip(scheme, level) {
    const paint = chipPaint(scheme, level);
    const sdf = roundRect(CHIP.w / 2, CHIP.h / 2, CHIP.radius);
    const layers = [
        { color: parseColor(paint.fill), covers: (x, y) => sdf(x, y) < 0 },
        {
            color: parseColor(paint.outline.color),
            covers: (x, y) => sdf(x, y) < paint.outline.width,
        },
    ];
    const { halo } = paint.outline;
    if (halo) {
        layers.push({
            color: parseColor(halo.color),
            covers: (x, y) => sdf(x, y) < halo.width,
        });
    }
    return {
        w: CHIP.w + CHIP.margin * 2,
        h: CHIP.h + CHIP.margin * 2,
        paint: over(layers),
    };
}

/** Even-odd point in polygon: for the (concave) star */
function inside(points) {
    return (x, y) => {
        let hit = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const [xi, yi] = points[i];
            const [xj, yj] = points[j];
            if (
                yi > y !== yj > y &&
                x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
            ) {
                hit = !hit;
            }
        }
        return hit;
    };
}

/** Direction of travel: an ink triangle pointing up, edged in the map colour */
function arrow(scheme) {
    const { width, height, margin, stroke } = ARROW;
    const sdf = polygon([
        [0, -height / 2],
        [width / 2, height / 2],
        [-width / 2, height / 2],
    ]);
    return {
        w: width + margin * 2,
        h: height + margin * 2,
        paint: over([
            {
                color: parseColor(COLORS[scheme].ink),
                covers: (x, y) => sdf(x, y) < 0,
            },
            {
                color: parseColor(COLORS[scheme].map),
                covers: (x, y) => sdf(x, y) < stroke / 2,
            },
        ]),
    };
}

/** Followed train: a small ink disc with a surface star and rim */
function follow(scheme) {
    const { outer, inner, dy } = MAP_FOLLOW_STAR;
    const star = [];
    for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        star.push([r * Math.cos(a), dy + r * Math.sin(a)]);
    }
    const inStar = inside(star);
    const surface = parseColor(COLORS[scheme].surface);
    const disc = FOLLOW_SIZE / 2 - MAP_FOLLOW_STAR.rim;
    return {
        w: FOLLOW_SIZE,
        h: FOLLOW_SIZE,
        paint: over([
            { color: surface, covers: inStar },
            {
                color: parseColor(COLORS[scheme].ink),
                covers: (x, y) => Math.hypot(x, y) < disc,
            },
            {
                color: surface,
                covers: (x, y) => Math.hypot(x, y) < FOLLOW_SIZE / 2,
            },
        ]),
    };
}

/**
 * The chosen station. `clear`: the map colour, opaque to MAP_STATION_MARK
 * .clear and fading out by .fade, under the trains. `ring`: a soft ink halo,
 * a surface disc and an ink ring.
 */
function station(scheme, part) {
    const { clear, fade, halo, ring: r } = MAP_STATION_MARK;
    const map = parseColor(COLORS[scheme].map);
    const ink = parseColor(COLORS[scheme].ink);
    if (part === "clear") {
        return {
            w: STATION_SIZE,
            h: STATION_SIZE,
            paint: (x, y) => {
                const d = Math.hypot(x, y);
                if (d >= fade) return null;
                const a = d <= clear ? 1 : 1 - (d - clear) / (fade - clear);
                return [map[0], map[1], map[2], a];
            },
        };
    }
    return {
        w: STATION_SIZE,
        h: STATION_SIZE,
        paint: over([
            {
                color: ink,
                covers: (x, y) =>
                    Math.abs(Math.hypot(x, y) - r.radius) < r.width / 2,
            },
            {
                color: parseColor(COLORS[scheme].surface),
                covers: (x, y) => Math.hypot(x, y) < r.radius,
            },
            {
                color: [ink[0], ink[1], ink[2], halo.opacity],
                covers: (x, y) => Math.hypot(x, y) < halo.radius,
            },
        ]),
    };
}

// --- output ---------------------------------------------------------------

const drawn = [];
for (const scheme of SCHEMES) {
    for (const shape of MARK_SHAPES) {
        for (const level of MARK_LEVELS) {
            drawn.push([
                markId(scheme, level, shape),
                mark(scheme, level, shape),
            ]);
        }
        drawn.push([ringId(scheme, shape), ring(scheme, shape)]);
    }
    for (const level of CHIP_LEVELS) {
        drawn.push([chipId(scheme, level), chip(scheme, level)]);
    }
    drawn.push(
        [arrowId(scheme), arrow(scheme)],
        [followId(scheme), follow(scheme)],
        [stationId(scheme, "clear"), station(scheme, "clear")],
        [stationId(scheme, "ring"), station(scheme, "ring")],
    );
}

const ids = drawn.map(([id]) => id);
if (JSON.stringify(ids) !== JSON.stringify(spriteIds())) {
    throw new Error("Drawn sprites differ from spriteIds()");
}

const files = new Map();
for (const [id, sprite] of drawn) {
    for (const scale of SCALES) {
        const suffix = scale === 1 ? "" : `@${scale}x`;
        files.set(
            `${id}${suffix}.png`,
            png(render(sprite.w, sprite.h, scale, sprite.paint)),
        );
    }
}

const entries = ids
    .map((id) => `    "${id}": require("../../assets/map/${id}.png"),`)
    .join("\n");
const table = `// Generated by scripts/map-sprites.mjs from the marker tokens. Do not edit.

import type { ImageRequireSource } from "react-native";

export const SPRITE_IMAGES: Record<string, ImageRequireSource> = {
${entries}
};
`;

if (process.argv.includes("--check")) {
    // The committed sprites must be what the tokens draw
    const stale = [];
    const read = (path) => (existsSync(path) ? readFileSync(path) : null);
    const onDisk = existsSync(outDir) ? readdirSync(outDir) : [];
    for (const name of new Set([...files.keys(), ...onDisk])) {
        const want = files.get(name);
        const have = read(`${outDir}${name}`);
        if (!want || !have || !samePixels(want, have)) stale.push(name);
    }
    if (read(tableFile)?.toString() !== table) stale.push("spriteImages.ts");
    if (stale.length > 0) {
        console.error(
            `Map sprites are out of date (${stale.slice(0, 5).join(", ")}…): run node scripts/map-sprites.mjs`,
        );
        process.exit(1);
    }
    console.log(`${ids.length} map sprites up to date`);
} else {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    let bytes = 0;
    for (const [name, file] of files) {
        bytes += file.length;
        writeFileSync(`${outDir}${name}`, file);
    }
    writeFileSync(tableFile, table);
    console.log(
        `${ids.length} sprites, ${files.size} files, ${(bytes / 1024).toFixed(1)} KB`,
    );
}
