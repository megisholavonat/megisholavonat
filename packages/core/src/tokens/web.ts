// Web adapter: the tokens as CSS custom properties. The app renders
// `themeCss()` once in <head>; globals.css maps the variables into Tailwind v4
// via `@theme inline` (e.g. `--color-delay-on-time: var(--mhav-delay-on-time-text)`).

import type { DelayLevel } from "../delay";
import {
    COLORS,
    type ColorScheme,
    DELAY_SCALE,
    EASING,
    MOTION,
    type Outline,
    RADII,
    SPACING,
    STALE_COLORS,
    TYPE_SCALE,
} from "./tokens";

export const CSS_VAR_PREFIX = "--mhav-";

export type CssVariables = Record<`--mhav-${string}`, string>;

const DELAY_SLUG: Record<DelayLevel, string> = {
    onTime: "on-time",
    slight: "slight",
    moderate: "moderate",
    severe: "severe",
};

const kebab = (name: string) =>
    name.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase();

/** `box-shadow` value drawing an outline (and halo) around a marker or swatch. */
export function outlineShadow(outline: Outline): string {
    const rings = [`0 0 0 ${outline.width}px ${outline.color}`];
    if (outline.halo) {
        rings.push(`0 0 0 ${outline.halo.width}px ${outline.halo.color}`);
    }
    return rings.join(", ");
}

/** Colour variables that differ between light and dark. */
export function cssVariables(scheme: ColorScheme): CssVariables {
    const vars: CssVariables = {};
    for (const [role, value] of Object.entries(COLORS[scheme])) {
        vars[`--mhav-${kebab(role)}`] = value;
    }
    for (const [level, colors] of Object.entries(DELAY_SCALE[scheme])) {
        const slug = DELAY_SLUG[level as DelayLevel];
        vars[`--mhav-delay-${slug}-fill`] = colors.fill;
        vars[`--mhav-delay-${slug}-text`] = colors.text;
        vars[`--mhav-delay-${slug}-label`] = colors.label;
        vars[`--mhav-delay-${slug}-outline`] = outlineShadow(colors.outline);
    }
    const stale = STALE_COLORS[scheme];
    vars["--mhav-stale-fill"] = stale.fill;
    vars["--mhav-stale-background"] = stale.background;
    vars["--mhav-stale-text"] = stale.text;
    vars["--mhav-stale-outline"] = stale.outline.color;
    return vars;
}

/** Variables shared by both schemes: type, spacing, radii, motion, plus the
 *  dark delay text for text on always-dark headers (`-text-on-dark`). */
export function staticCssVariables(): CssVariables {
    const vars: CssVariables = {};
    for (const [level, colors] of Object.entries(DELAY_SCALE.dark)) {
        vars[`--mhav-delay-${DELAY_SLUG[level as DelayLevel]}-text-on-dark`] =
            colors.text;
    }
    vars["--mhav-stale-text-on-dark"] = STALE_COLORS.dark.text;
    for (const [name, style] of Object.entries(TYPE_SCALE)) {
        const slug = kebab(name);
        vars[`--mhav-text-${slug}`] = `${style.fontSize}px`;
        vars[`--mhav-text-${slug}-line-height`] = `${style.lineHeight}px`;
        vars[`--mhav-text-${slug}-font-weight`] = String(style.fontWeight);
    }
    for (const [step, px] of Object.entries(SPACING)) {
        vars[`--mhav-space-${step}`] = `${px}px`;
    }
    for (const [name, px] of Object.entries(RADII)) {
        vars[`--mhav-radius-${kebab(name)}`] = `${px}px`;
    }
    for (const [name, easing] of Object.entries(EASING)) {
        vars[`--mhav-ease-${kebab(name)}`] = easing.css;
    }
    vars["--mhav-duration-sheet"] = `${MOTION.sheet.duration}ms`;
    vars["--mhav-duration-delay-change"] = `${MOTION.delayChange.duration}ms`;
    vars["--mhav-duration-follow"] = `${MOTION.follow.duration}ms`;
    return vars;
}

function block(selector: string, vars: CssVariables): string {
    const body = Object.entries(vars)
        .map(([name, value]) => `${name}:${value};`)
        .join("");
    return `${selector}{${body}}`;
}

/** The full stylesheet: light + static variables on `:root`, dark on `.dark`. */
export function themeCss({
    light = ":root",
    dark = ".dark",
}: {
    light?: string;
    dark?: string;
} = {}): string {
    return (
        block(light, { ...cssVariables("light"), ...staticCssVariables() }) +
        block(dark, cssVariables("dark"))
    );
}
