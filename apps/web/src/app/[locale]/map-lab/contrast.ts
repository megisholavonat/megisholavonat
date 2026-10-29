import { type ColorScheme, DELAY_SCALE } from "@megisholavonat/core/tokens";
import { CURRENT, QUIET, TRANSIT } from "./palettes";
import type { Basemap } from "./styles";

function luminance(hex: string): number {
    const h = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => {
        const c = Number.parseInt(h.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio */
export function contrast(a: string, b: string): number {
    const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
}

export interface ContrastRow {
    label: string;
    fg: string;
    bg: string;
    ratio: number;
    /** What the pair has to reach: 3 for graphics, 4.5 for text */
    target: number;
}

/**
 * Key pairs of a basemap and theme. "Current" uses the OpenFreeMap colours
 * with our land patched in and the railway raster as the app blends it.
 */
export function contrastRows(
    basemap: Basemap,
    scheme: ColorScheme,
): ContrastRow[] {
    const p =
        basemap === "current"
            ? CURRENT[scheme]
            : basemap === "transit"
              ? TRANSIT[scheme]
              : QUIET[scheme];
    const delay = DELAY_SCALE[scheme];
    const rows: [string, string, number][] = [
        ["Main line", p.rail, 3],
        ["Branch line", p.railMinor, 3],
        ["Border", p.border, 3],
        ["Water", p.water, 1.3],
        ["City label", p.city, 4.5],
        ["Village label", p.village, 4.5],
        ...("stationLabel" in p
            ? [
                  ["Station label", p.stationLabel as string, 4.5] as [
                      string,
                      string,
                      number,
                  ],
              ]
            : []),
        ["On time marker", delay.onTime.fill, 3],
        ["+60 marker", delay.severe.fill, 3],
    ];
    return rows.map(([label, fg, target]) => ({
        label,
        fg,
        bg: p.land,
        ratio: contrast(fg, p.land),
        target,
    }));
}
