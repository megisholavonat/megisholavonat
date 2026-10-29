// Link preview images (1200x630) drawn with next/og (satori). Light theme
// tokens; every <div> with more than one child is a flex box (satori rule).

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DelayLevel } from "@megisholavonat/core/delay";
import type { Locale } from "@megisholavonat/core/i18n";
import { COLORS, DELAY_SCALE } from "@megisholavonat/core/tokens";
import { ImageResponse } from "next/og";
import type { ReactElement, ReactNode } from "react";
import { cachedLoad } from "@/lib/og/cache";
import { OG_SIZE } from "@/lib/og/metadata";
import type { RouteSketch, StationCard, TrainCard } from "@/lib/og/model";
import { PREVIEW_MAX_AGE } from "@/lib/og/server";

const C = COLORS.light;
const SCALE = DELAY_SCALE.light;
const PAD = 56;

const TEXT = {
    hu: {
        app: "Mégis hol a vonat?",
        tagline: "Vonatok és késések élőben, térképen",
        minutesLate: "perc késés",
        onTime: "pontos",
        waiting: "indulásra vár",
        noData: "nincs friss adat",
        next: "Következő megálló",
        departs: "Indul",
        departures: "Indulások",
        noDepartures: "Most nincs induló vonat",
        canceled: "törölve",
        arrived: "megérkezett",
        platform: (p: string) => `${p}. vágány`,
    },
    en: {
        app: "Mégis hol a vonat?",
        tagline: "Hungarian trains and delays, live on a map",
        minutesLate: "min late",
        onTime: "on time",
        waiting: "waiting to depart",
        noData: "no fresh data",
        next: "Next stop",
        departs: "Departs",
        departures: "Departures",
        noDepartures: "No departures right now",
        canceled: "cancelled",
        arrived: "arrived",
        platform: (p: string) => `Platform ${p}`,
    },
} as const;

/** Chip / tile tint: the level fill over white, as the web's --tint tokens. */
const TINT_SHARE: Record<DelayLevel, number> = {
    onTime: 0.14,
    slight: 0.22,
    moderate: 0.16,
    severe: 0.14,
};

function tint(level: DelayLevel): string {
    const hex = SCALE[level].fill.slice(1);
    const share = TINT_SHARE[level];
    const mix = (i: number) =>
        Math.round(
            Number.parseInt(hex.slice(i, i + 2), 16) * share +
                255 * (1 - share),
        )
            .toString(16)
            .padStart(2, "0");
    return `#${mix(0)}${mix(2)}${mix(4)}`;
}

// Literal paths, so the build traces exactly these files
const FONT_FILES = {
    400: () => readFile(join(process.cwd(), "src/lib/og/fonts/Inter-400.woff")),
    600: () => readFile(join(process.cwd(), "src/lib/og/fonts/Inter-600.woff")),
    700: () => readFile(join(process.cwd(), "src/lib/og/fonts/Inter-700.woff")),
    800: () => readFile(join(process.cwd(), "src/lib/og/fonts/Inter-800.woff")),
} as const;

// A failed read is retried on the next request, not cached until restart
const loadFonts = cachedLoad(() =>
    Promise.all([
        ...([400, 600, 700, 800] as const).map(async (weight) => ({
            name: "Inter",
            data: await FONT_FILES[weight](),
            weight,
        })),
        readFile(join(process.cwd(), "src/app/MNR2007.ttf")).then((data) => ({
            name: "MNR2007",
            data,
            weight: 400 as const,
        })),
    ]),
);

const loadIcon = cachedLoad(() =>
    readFile(join(process.cwd(), "public/icon-192.png")).then(
        (data) => `data:image/png;base64,${data.toString("base64")}`,
    ),
);

async function render(node: (icon: string) => ReactElement): Promise<Response> {
    const [fonts, icon] = await Promise.all([loadFonts(), loadIcon()]);
    return new ImageResponse(node(icon), {
        ...OG_SIZE,
        fonts: fonts.map((f) => ({ ...f, style: "normal" as const })),
        headers: {
            "Cache-Control": `public, max-age=${PREVIEW_MAX_AGE}, s-maxage=${PREVIEW_MAX_AGE}`,
        },
    });
}

function Frame({
    icon,
    locale,
    children,
}: {
    icon: string;
    locale: Locale;
    children: ReactNode;
}) {
    return (
        <div
            style={{
                width: "100%",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                padding: PAD,
                background: C.surface,
                color: C.ink,
                fontFamily: "Inter",
            }}
        >
            <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
                {children}
            </div>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    marginTop: 28,
                    paddingTop: 24,
                    borderTop: `2px solid ${C.line}`,
                }}
            >
                {/* biome-ignore lint/performance/noImgElement: satori */}
                <img src={icon} width={44} height={44} alt="" />
                <div
                    style={{
                        marginLeft: 16,
                        fontSize: 28,
                        fontWeight: 700,
                    }}
                >
                    {TEXT[locale].app}
                </div>
                <div
                    style={{
                        marginLeft: "auto",
                        fontSize: 26,
                        fontWeight: 600,
                        color: C.ink2,
                    }}
                >
                    megisholavonat.info
                </div>
            </div>
        </div>
    );
}

function Glyph({
    glyph,
    color,
    size,
}: {
    glyph: string | null;
    color: string;
    size: number;
}) {
    if (!glyph) return null;
    return (
        <div
            style={{
                fontFamily: "MNR2007",
                fontSize: size,
                lineHeight: 1,
                color,
                marginRight: size * 0.28,
            }}
        >
            {glyph}
        </div>
    );
}

const ellipsis = {
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
} as const;

function path(points: [number, number][], w: number, h: number): string {
    return points
        .map(
            ([x, y], i) =>
                `${i === 0 ? "M" : "L"}${(x * w).toFixed(1)} ${(y * h).toFixed(1)}`,
        )
        .join(" ");
}

const SKETCH_INSET = 52;

/** The route on a map-coloured panel, run part dark, train as a dot. */
function sketchSvg(
    sketch: RouteSketch,
    level: DelayLevel | "stale",
    width: number,
    height: number,
): string {
    const inset = SKETCH_INSET;
    const w = width - 2 * inset;
    const h = height - 2 * inset;
    const fill = level === "stale" ? "#9AA0A8" : SCALE[level].fill;
    const last = sketch.stops.length - 1;
    const line = (points: [number, number][], stroke: string) =>
        points.length > 1
            ? `<path d="${path(points, w, h)}" fill="none" stroke="${stroke}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`
            : "";
    const dot = ([x, y]: [number, number], r: number, rest: string) =>
        `<circle cx="${(x * w).toFixed(1)}" cy="${(y * h).toFixed(1)}" r="${r}" ${rest}/>`;
    const stops = sketch.stops
        .map((p, i) =>
            i === 0 || i === last
                ? dot(
                      p,
                      10,
                      `fill="${C.surface}" stroke="${C.ink}" stroke-width="5"`,
                  )
                : dot(
                      p,
                      5.5,
                      `fill="${C.surface}" stroke="${C.ink}" stroke-width="3"`,
                  ),
        )
        .join("");
    const train = sketch.train
        ? dot(sketch.train, 25, `fill="rgba(20,22,26,0.18)"`) +
          dot(
              sketch.train,
              18,
              `fill="${fill}" stroke="${C.surface}" stroke-width="5"`,
          )
        : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${-inset} ${-inset} ${width} ${height}">${line(sketch.ahead, "#A4AAB3")}${line(sketch.passed, C.ink)}${stops}${train}</svg>`;
}

function Sketch({
    sketch,
    level,
    width,
    height,
}: {
    sketch: RouteSketch;
    level: DelayLevel | "stale";
    width: number;
    height: number;
}) {
    const svg = sketchSvg(sketch, level, width, height);
    const labelWidth = 220;
    return (
        <div
            style={{
                display: "flex",
                position: "relative",
                width,
                height,
                borderRadius: 32,
                background: C.map,
            }}
        >
            {/* biome-ignore lint/performance/noImgElement: satori */}
            <img
                src={`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`}
                width={width}
                height={height}
                alt=""
            />
            {sketch.ends.map(({ name, at: [x, y] }, i) => {
                const px = SKETCH_INSET + x * (width - 2 * SKETCH_INSET);
                const py = SKETCH_INSET + y * (height - 2 * SKETCH_INSET);
                const below = py < height - 70;
                return (
                    <div
                        // biome-ignore lint/suspicious/noArrayIndexKey: two ends
                        key={i}
                        style={{
                            position: "absolute",
                            display: "flex",
                            justifyContent: "center",
                            width: labelWidth,
                            left: Math.min(
                                Math.max(px - labelWidth / 2, 12),
                                width - labelWidth - 12,
                            ),
                            top: below ? py + 20 : py - 56,
                        }}
                    >
                        <div
                            style={{
                                padding: "3px 10px",
                                borderRadius: 8,
                                background: "rgba(255,255,255,0.92)",
                                fontSize: 21,
                                fontWeight: 600,
                                color: C.ink2,
                                ...ellipsis,
                            }}
                        >
                            {name}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function ProgressBar({ progress, level }: { progress: number; level: string }) {
    return (
        <div
            style={{
                display: "flex",
                width: "100%",
                height: 14,
                borderRadius: 7,
                background: C.surface2,
            }}
        >
            <div
                style={{
                    width: `${Math.max(4, progress * 100)}%`,
                    height: 14,
                    borderRadius: 7,
                    background: level,
                }}
            />
        </div>
    );
}

const SKETCH = { width: 440, height: 410 };

export function trainImage(card: TrainCard, locale: Locale) {
    const t = TEXT[locale];
    // A delay only while running, as on the map and in the sheet
    const running = card.status === "running";
    const level = running ? card.level : "stale";
    const color = running ? SCALE[card.level].text : C.ink2;
    const background = running ? tint(card.level) : C.surface2;
    const caption = {
        running: card.level === "onTime" ? t.onTime : t.minutesLate,
        waiting: t.waiting,
        cancelled: t.canceled,
        arrived: t.arrived,
        noData: t.noData,
    }[card.status];
    const big = running
        ? card.delay > 0
            ? `+${card.delay}`
            : "0"
        : card.status === "noData"
          ? "?"
          : "–";
    return render((icon) => (
        <Frame icon={icon} locale={locale}>
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    flex: 1,
                    minWidth: 0,
                    paddingRight: card.sketch ? 48 : 0,
                }}
            >
                <div style={{ display: "flex", alignItems: "center" }}>
                    <Glyph glyph={card.glyph} color={C.ink} size={60} />
                    <div
                        style={{
                            fontSize: 64,
                            fontWeight: 800,
                            letterSpacing: -1.5,
                            lineHeight: 1,
                        }}
                    >
                        {card.number}
                    </div>
                    {card.name && (
                        <div
                            style={{
                                marginLeft: 18,
                                fontSize: 32,
                                fontWeight: 600,
                                color: C.ink2,
                                ...ellipsis,
                            }}
                        >
                            {card.name}
                        </div>
                    )}
                </div>
                <div
                    style={{
                        marginTop: 18,
                        fontSize: 46,
                        fontWeight: 700,
                        letterSpacing: -0.5,
                        ...ellipsis,
                    }}
                >
                    {`→ ${card.destination}`}
                </div>
                <div
                    style={{
                        display: "flex",
                        alignItems: "stretch",
                        marginTop: "auto",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "center",
                            minWidth: 230,
                            padding: "22px 34px",
                            borderRadius: 28,
                            background,
                            border: card.stale
                                ? `3px dashed ${C.ink2}`
                                : `3px solid ${background}`,
                        }}
                    >
                        <div
                            style={{
                                fontSize: 120,
                                fontWeight: 800,
                                lineHeight: 1,
                                letterSpacing: -4,
                                color,
                            }}
                        >
                            {big}
                        </div>
                        <div
                            style={{
                                marginTop: 10,
                                fontSize: 28,
                                fontWeight: 700,
                                color,
                            }}
                        >
                            {caption}
                        </div>
                    </div>
                    {card.next && (
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "center",
                                marginLeft: 36,
                                minWidth: 0,
                                flex: 1,
                            }}
                        >
                            <div
                                style={{
                                    fontSize: 26,
                                    fontWeight: 600,
                                    color: C.ink2,
                                }}
                            >
                                {card.waiting ? t.departs : t.next}
                            </div>
                            <div
                                style={{
                                    marginTop: 8,
                                    fontSize:
                                        card.next.name.length > 12 ? 32 : 40,
                                    fontWeight: 700,
                                    lineHeight: 1.15,
                                    lineClamp: 2,
                                }}
                            >
                                {card.next.name}
                            </div>
                            <div
                                style={{
                                    marginTop: 4,
                                    fontSize: 40,
                                    fontWeight: 700,
                                    color: C.ink2,
                                }}
                            >
                                {`${card.next.estimated ? "≈" : ""}${card.next.time}`}
                            </div>
                        </div>
                    )}
                </div>
                {!card.sketch && (
                    <div style={{ display: "flex", marginTop: 32 }}>
                        <ProgressBar
                            progress={card.progress}
                            level={
                                level === "stale"
                                    ? "#9AA0A8"
                                    : SCALE[level].fill
                            }
                        />
                    </div>
                )}
            </div>
            {card.sketch && (
                <Sketch sketch={card.sketch} level={level} {...SKETCH} />
            )}
        </Frame>
    ));
}

export const TRAIN_SKETCH_ASPECT = SKETCH.width / SKETCH.height;

export function stationImage(card: StationCard, locale: Locale) {
    const t = TEXT[locale];
    return render((icon) => (
        <Frame icon={icon} locale={locale}>
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    flex: 1,
                    minWidth: 0,
                }}
            >
                <div
                    style={{
                        fontSize: 26,
                        fontWeight: 600,
                        color: C.ink2,
                    }}
                >
                    {t.departures}
                </div>
                <div
                    style={{
                        marginTop: 4,
                        fontSize: 60,
                        fontWeight: 800,
                        letterSpacing: -1.5,
                        lineHeight: 1.1,
                        ...ellipsis,
                    }}
                >
                    {card.name}
                </div>
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        marginTop: 18,
                    }}
                >
                    {card.departures.length === 0 && (
                        <div
                            style={{
                                marginTop: 40,
                                fontSize: 34,
                                fontWeight: 600,
                                color: C.ink2,
                            }}
                        >
                            {t.noDepartures}
                        </div>
                    )}
                    {card.departures.map((d, i) => (
                        <div
                            // biome-ignore lint/suspicious/noArrayIndexKey: static
                            key={i}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                height: 76,
                                borderTop:
                                    i === 0 ? "none" : `2px solid ${C.line}`,
                            }}
                        >
                            <div
                                style={{
                                    width: 128,
                                    fontSize: 36,
                                    fontWeight: 700,
                                    color: d.canceled ? C.ink2 : C.ink,
                                    textDecoration: d.canceled
                                        ? "line-through"
                                        : "none",
                                }}
                            >
                                {d.time}
                            </div>
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    width: 190,
                                }}
                            >
                                <Glyph
                                    glyph={d.glyph}
                                    color={C.ink2}
                                    size={36}
                                />
                                <div
                                    style={{
                                        fontSize: 28,
                                        fontWeight: 600,
                                        color: C.ink2,
                                    }}
                                >
                                    {d.number}
                                </div>
                            </div>
                            <div
                                style={{
                                    flex: 1,
                                    minWidth: 0,
                                    fontSize: 36,
                                    fontWeight: 600,
                                    ...ellipsis,
                                }}
                            >
                                {d.headsign}
                            </div>
                            {d.platform && (
                                <div
                                    style={{
                                        marginLeft: 24,
                                        fontSize: 26,
                                        fontWeight: 600,
                                        color: C.ink2,
                                    }}
                                >
                                    {t.platform(d.platform)}
                                </div>
                            )}
                            {d.canceled || d.level ? (
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "center",
                                        marginLeft: 24,
                                        minWidth: 120,
                                        padding: "6px 18px",
                                        borderRadius: 999,
                                        background: d.level
                                            ? tint(d.level)
                                            : C.surface2,
                                        color: d.level
                                            ? SCALE[d.level].text
                                            : C.ink2,
                                        fontSize: 30,
                                        fontWeight: 800,
                                    }}
                                >
                                    {d.canceled || !d.level
                                        ? t.canceled
                                        : d.level === "onTime"
                                          ? t.onTime
                                          : `+${d.delay}`}
                                </div>
                            ) : (
                                // Not live yet: the plain time, as on the board
                                <div
                                    style={{ marginLeft: 24, minWidth: 120 }}
                                />
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </Frame>
    ));
}

/** The app card: for a train that is gone, or a link without a selection. */
export function genericImage(locale: Locale) {
    const t = TEXT[locale];
    return render((icon) => (
        <div
            style={{
                width: "100%",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                padding: 88,
                background: C.surface,
                color: C.ink,
                fontFamily: "Inter",
            }}
        >
            {/* biome-ignore lint/performance/noImgElement: satori */}
            <img src={icon} width={128} height={128} alt="" />
            <div
                style={{
                    marginTop: 40,
                    fontSize: 84,
                    fontWeight: 800,
                    letterSpacing: -2.5,
                    lineHeight: 1,
                }}
            >
                {t.app}
            </div>
            <div
                style={{
                    marginTop: 20,
                    fontSize: 38,
                    fontWeight: 600,
                    color: C.ink2,
                }}
            >
                {t.tagline}
            </div>
        </div>
    ));
}
