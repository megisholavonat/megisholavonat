// Design tokens of the approved MHaV design system (boards "DS · Színek és
// késésskála", "DS · Tipográfia, térköz, mozgás, ikonok" and "DS · Térképjelölő").
// One source for the web (./web) and the Expo app (./native).
//
// Colour rule of the system: the surface is neutral ink, only data (the
// delay) is coloured, and always together with a minute label or a size.

import type { DelayLevel } from "../delay";

export type ColorScheme = "light" | "dark";

/** Neutral surface roles. No brand colour: actions are ink. */
export interface ColorRoles {
    /** Page / app background behind cards and sheets */
    canvas: string;
    /** Cards, sheets, panels */
    surface: string;
    /** Secondary fills: chips, inputs, grouped rows */
    surface2: string;
    /** Primary text */
    ink: string;
    /** Secondary text, ≥4.5:1 on surface and surface2 */
    ink2: string;
    /** Hairlines and dividers */
    line: string;
    /** Buttons and selection */
    action: string;
    /** Text and icons on `action` */
    onAction: string;
    /** Icon-only accent (follow star); never text */
    accent: string;
    /** Map land colour the markers are checked against */
    map: string;
}

export const COLORS = {
    light: {
        canvas: "#F4F5F7",
        surface: "#FFFFFF",
        surface2: "#ECEEF1",
        ink: "#14161A",
        ink2: "#5E646E",
        line: "#DADDE2",
        action: "#14161A",
        onAction: "#FFFFFF",
        accent: "#F2C230",
        map: "#EEF0EC",
    },
    dark: {
        canvas: "#111316",
        surface: "#17191D",
        surface2: "#22252B",
        ink: "#F2F3F5",
        ink2: "#A2A8B2",
        // Not on the board: one step above surface-2
        line: "#33373E",
        action: "#F2F3F5",
        onAction: "#14161A",
        accent: "#FFC93D",
        map: "#1A1D22",
    },
} as const satisfies Record<ColorScheme, ColorRoles>;

/** Marker / swatch outline: a ring drawn around the fill. */
export interface Outline {
    color: string;
    width: number;
    /** Optional second, outer ring (light-mode blue and red markers) */
    halo?: { color: string; width: number };
}

export interface DelayLevelColors {
    /** Marker and legend fill */
    fill: string;
    /** Delay text ("+7", "pontos") on surface, ≥4.5:1 */
    text: string;
    /** Minute label drawn on the fill ("+N") */
    label: string;
    /**
     * Chip and tile background: the fill, translucent (#RRGGBBAA), so it
     * reads the same on any surface. Text on it uses `text`.
     */
    tint: string;
    outline: Outline;
}

/** `fill` at `alpha` as #RRGGBBAA. */
function tintOf(fill: string, alpha: number): string {
    const a = Math.round(alpha * 255)
        .toString(16)
        .padStart(2, "0")
        .toUpperCase();
    return `${fill}${a}`;
}

/**
 * Tint strength per level: yellow needs more to show on white, orange a
 * little more than blue and red.
 */
const TINT_ALPHA = {
    onTime: 0.14,
    slight: 0.22,
    moderate: 0.16,
    severe: 0.14,
} as const satisfies Record<DelayLevel, number>;

/** Inner white ring + soft ink halo for fills that already contrast with the map. */
const LIGHT_HALO: Outline = {
    color: "#FFFFFF",
    width: 1.5,
    halo: { color: "rgba(20,22,26,0.45)", width: 2.5 },
};
/** Yellow and orange get a dark ink outline: their fill alone is < 3:1 on the map. */
const LIGHT_INK_OUTLINE: Outline = { color: "#14161A", width: 1.5 };
const DARK_OUTLINE: Outline = { color: COLORS.dark.map, width: 1.5 };

/** The delay scale, keyed by `getDelayLevel` levels. */
export const DELAY_SCALE = {
    light: {
        onTime: {
            fill: "#1A6CCF",
            text: "#0B5FB8",
            label: "#FFFFFF",
            tint: tintOf("#1A6CCF", TINT_ALPHA.onTime),
            outline: LIGHT_HALO,
        },
        slight: {
            fill: "#F2C230",
            text: "#8A5A00",
            label: "#14161A",
            tint: tintOf("#F2C230", TINT_ALPHA.slight),
            outline: LIGHT_INK_OUTLINE,
        },
        moderate: {
            fill: "#E5660B",
            text: "#B23F00",
            label: "#14161A",
            tint: tintOf("#E5660B", TINT_ALPHA.moderate),
            outline: LIGHT_INK_OUTLINE,
        },
        severe: {
            fill: "#C41E16",
            text: "#B3261E",
            label: "#FFFFFF",
            tint: tintOf("#C41E16", TINT_ALPHA.severe),
            outline: LIGHT_HALO,
        },
    },
    dark: {
        onTime: {
            fill: "#5BA8FF",
            text: "#7CB8FF",
            label: "#14161A",
            tint: tintOf("#5BA8FF", TINT_ALPHA.onTime),
            outline: DARK_OUTLINE,
        },
        slight: {
            fill: "#FFC93D",
            text: "#F7D35C",
            label: "#14161A",
            tint: tintOf("#FFC93D", TINT_ALPHA.slight),
            outline: DARK_OUTLINE,
        },
        moderate: {
            fill: "#FF8A1F",
            text: "#FF9E5E",
            label: "#14161A",
            tint: tintOf("#FF8A1F", TINT_ALPHA.moderate),
            outline: DARK_OUTLINE,
        },
        severe: {
            fill: "#F2453D",
            text: "#FF7B72",
            label: "#14161A",
            tint: tintOf("#F2453D", TINT_ALPHA.severe),
            outline: DARK_OUTLINE,
        },
    },
} as const satisfies Record<ColorScheme, Record<DelayLevel, DelayLevelColors>>;

/** Stale trains (no fresh data): hollow, dashed grey. */
export const STALE_COLORS = {
    light: {
        /** Small dot / legend swatch */
        fill: "#9AA0A8",
        /** Hollow pill background */
        background: "#FFFFFF",
        text: "#5E646E",
        outline: { color: "#5E646E", width: 1.5, dashed: true },
    },
    dark: {
        fill: "#7A808A",
        background: COLORS.dark.map,
        text: "#A2A8B2",
        outline: { color: "#A2A8B2", width: 1.5, dashed: true },
    },
} as const;

/** Families per platform; the web uses Inter. */
export const FONT_FAMILY = {
    ios: "SF Pro",
    android: "Roboto Flex",
    web: "Inter",
} as const;

export interface TypeStyle {
    fontSize: number;
    lineHeight: number;
    fontWeight: 400 | 500 | 600 | 700 | 800;
    /** Platform text style it maps to */
    ios: string;
    android: string;
}

export const TYPE_SCALE = {
    delayXl: {
        fontSize: 40,
        lineHeight: 44,
        fontWeight: 800,
        ios: "largeTitle",
        android: "displaySmall",
    },
    title: {
        fontSize: 22,
        lineHeight: 28,
        fontWeight: 700,
        ios: "title2",
        android: "titleLarge",
    },
    headline: {
        fontSize: 17,
        lineHeight: 22,
        fontWeight: 600,
        ios: "headline",
        android: "titleMedium",
    },
    body: {
        fontSize: 16,
        lineHeight: 22,
        fontWeight: 400,
        ios: "body",
        android: "bodyLarge",
    },
    caption: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: 500,
        ios: "caption",
        android: "labelMedium",
    },
} as const satisfies Record<string, TypeStyle>;

export type TypeToken = keyof typeof TYPE_SCALE;

/** Times and delays use tabular figures everywhere. */
export const TABULAR_NUMS = "tnum";

/** 4 px grid. */
export const SPACING = {
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    6: 24,
    8: 32,
} as const;

/** Minimum touch target, also for map markers. */
export const TOUCH_TARGET = 44;

export const RADII = {
    sm: 6,
    md: 10,
    lg: 14,
    /** Web bottom sheet top corners */
    sheetWeb: 20,
    /** Material 3 bottom sheet top corners */
    sheetAndroid: 28,
    pill: 999,
} as const;

export interface Easing {
    css: string;
    /** Cubic bezier control points, for Reanimated's Easing.bezier */
    bezier: readonly [number, number, number, number];
}

export const EASING = {
    /** Sheet detents on the web; iOS and Android use their system springs */
    sheet: {
        css: "cubic-bezier(0.32, 0.72, 0, 1)",
        bezier: [0.32, 0.72, 0, 1],
    },
    linear: { css: "linear", bezier: [0, 0, 1, 1] },
    standard: { css: "ease-out", bezier: [0, 0, 0.58, 1] },
} as const satisfies Record<string, Easing>;

/** Durations in ms. */
export const MOTION = {
    /** Sheet snapping to a detent (web) */
    sheet: { duration: 320, easing: EASING.sheet },
    /** Tap on a marker → sheet visible (with skeleton) */
    tapToSheetMax: 100,
    /** Marker glides between position updates; with reduced motion it jumps */
    markerMove: { duration: 60_000, easing: EASING.linear },
    /** Delay number rolls to its new value */
    delayChange: { duration: 200, easing: EASING.standard },
    /** Follow star shape change (iOS adds .success haptics) */
    follow: { duration: 150, easing: EASING.standard },
} as const;

export interface MarkerLevelSpec {
    /** Dot diameter below zoom 9 (no label) */
    dot: number;
    /** Pill height at zoom ≥ 9; on time is a 16 px circle without label */
    height: number;
    /** Label font size; 0 when unlabelled */
    fontSize: number;
    /** Horizontal padding [left (direction arrow side), right] */
    padding: readonly [number, number];
}

/** Map marker: colour + size + minutes. Shape = vehicle type. */
export const MARKER = {
    /** Zoom where dots turn into labelled pills */
    labelMinZoom: 9,
    hitArea: TOUCH_TARGET,
    outlineWidth: 1.5,
    /** Size grows with severity; larger delays draw on top */
    levels: {
        onTime: { dot: 8, height: 16, fontSize: 0, padding: [0, 0] },
        slight: { dot: 10, height: 22, fontSize: 12, padding: [5, 7] },
        moderate: { dot: 12, height: 24, fontSize: 13, padding: [6, 8] },
        severe: { dot: 14, height: 26, fontSize: 14, padding: [7, 9] },
    },
    stale: { dot: 10, height: 22, fontSize: 12, padding: [7, 7] },
    label: {
        fontWeight: 800,
        tabularNums: true,
        // The text itself is `trainDisplay().label`: "+N" when late, the
        // last known "+N?" on a stale (dashed) marker, none when on time
    },
    /** Shape by vehicle type: trains are round pills, HÉV is square-ish */
    radius: { train: RADII.pill, hev: 5, hevDot: 4 },
    selected: {
        gap: 2,
        ringWidth: 3,
        /** Other markers fade to this opacity */
        othersOpacity: 0.6,
    },
    followBadge: { size: 16, offset: { top: -8, right: -10 } },
} as const satisfies {
    levels: Record<DelayLevel, MarkerLevelSpec>;
    stale: MarkerLevelSpec;
    [key: string]: unknown;
};

/** Product rules that come with the design system. */
export const DISPLAY_RULES = {
    /** "Usually late" hint: only before departure */
    usuallyLate: { minTypicalDelayMinutes: 3, minRuns: 5 },
    /** Predicted platform shows as "6?" */
    predictedPlatform: { minConfidence: 0.8, suffix: "?" },
    /** Android Material You dynamic colour: opt-in setting, off by default */
    androidDynamicColorDefault: false,
} as const;
