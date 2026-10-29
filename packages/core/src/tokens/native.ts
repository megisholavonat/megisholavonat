// React Native adapter: plain objects ready for StyleSheet.create. No
// react-native import, so the shapes are spelled out here.

import type { DelayLevel } from "../delay";
import {
    COLORS,
    type ColorRoles,
    type ColorScheme,
    DELAY_SCALE,
    type DelayLevelColors,
    FONT_FAMILY,
    MOTION,
    RADII,
    SPACING,
    STALE_COLORS,
    TYPE_SCALE,
    type TypeToken,
} from "./tokens";

type FontWeight = "400" | "500" | "600" | "700" | "800";

export interface NativeTextStyle {
    fontSize: number;
    lineHeight: number;
    fontWeight: FontWeight;
}

export interface NativeTheme {
    scheme: ColorScheme;
    dark: boolean;
    colors: ColorRoles;
    delay: Record<DelayLevel, DelayLevelColors>;
    stale: (typeof STALE_COLORS)[ColorScheme];
    type: Record<TypeToken, NativeTextStyle>;
    /** Spread into a Text style for times and delays */
    tabularNums: { fontVariant: ["tabular-nums"] };
    fontFamily: { ios: string; android: string };
    spacing: typeof SPACING;
    radii: typeof RADII;
    motion: typeof MOTION;
}

const type = Object.fromEntries(
    Object.entries(TYPE_SCALE).map(([name, style]) => [
        name,
        {
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
            fontWeight: String(style.fontWeight) as FontWeight,
        },
    ]),
) as Record<TypeToken, NativeTextStyle>;

export function nativeTheme(scheme: ColorScheme): NativeTheme {
    return {
        scheme,
        dark: scheme === "dark",
        colors: COLORS[scheme],
        delay: DELAY_SCALE[scheme],
        stale: STALE_COLORS[scheme],
        type,
        tabularNums: { fontVariant: ["tabular-nums"] },
        fontFamily: { ios: FONT_FAMILY.ios, android: FONT_FAMILY.android },
        spacing: SPACING,
        radii: RADII,
        motion: MOTION,
    };
}

export const lightTheme = nativeTheme("light");
export const darkTheme = nativeTheme("dark");
