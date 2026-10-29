import type { ColorRoles } from "@megisholavonat/core/tokens";

// Bridges between the design-system roles and Material 3 colour roles. Pure
// (types only), so it is unit tested under Node.

/** The Material roles the app reads or overrides. */
export interface MaterialRoles {
    primary: string;
    onPrimary: string;
    primaryContainer: string;
    onPrimaryContainer: string;
    secondary: string;
    onSecondary: string;
    secondaryContainer: string;
    onSecondaryContainer: string;
    background: string;
    onBackground: string;
    surface: string;
    onSurface: string;
    surfaceVariant: string;
    onSurfaceVariant: string;
    surfaceContainerLowest: string;
    surfaceContainerLow: string;
    surfaceContainer: string;
    surfaceContainerHigh: string;
    surfaceContainerHighest: string;
    outline: string;
    outlineVariant: string;
    inverseSurface: string;
    inverseOnSurface: string;
}

/** #RGB / #RRGGBB to the #RRGGBBAA form Expo UI expects. */
function rgba(hex: string): `#${string}` {
    const h = hex.replace("#", "").toUpperCase();
    const full =
        h.length === 3
            ? h
                  .split("")
                  .map((c) => c + c)
                  .join("")
            : h;
    return `#${full.length === 6 ? `${full}FF` : full}`;
}

/**
 * The fixed neutral scheme for Compose hosts while dynamic colour is off:
 * ink actions on neutral surfaces, no brand colour.
 */
export function materialOverrides(
    c: ColorRoles,
): Record<keyof MaterialRoles, `#${string}`> {
    return {
        primary: rgba(c.action),
        onPrimary: rgba(c.onAction),
        primaryContainer: rgba(c.surface2),
        onPrimaryContainer: rgba(c.ink),
        secondary: rgba(c.ink2),
        onSecondary: rgba(c.surface),
        secondaryContainer: rgba(c.surface2),
        onSecondaryContainer: rgba(c.ink),
        background: rgba(c.canvas),
        onBackground: rgba(c.ink),
        surface: rgba(c.canvas),
        onSurface: rgba(c.ink),
        surfaceVariant: rgba(c.surface2),
        onSurfaceVariant: rgba(c.ink2),
        surfaceContainerLowest: rgba(c.surface),
        surfaceContainerLow: rgba(c.surface),
        surfaceContainer: rgba(c.surface),
        surfaceContainerHigh: rgba(c.surface2),
        surfaceContainerHighest: rgba(c.surface2),
        outline: rgba(c.ink2),
        outlineVariant: rgba(c.line),
        inverseSurface: rgba(c.ink),
        inverseOnSurface: rgba(c.surface),
    };
}

/** `color` (#RGB, #RRGGBB or #RRGGBBAA) at `alpha` (0–1) opacity. */
export function withAlpha(color: string, alpha: number): string {
    const base = rgba(color).slice(0, 7);
    const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
        .toString(16)
        .toUpperCase()
        .padStart(2, "0");
    return `${base}${a}`;
}

/**
 * Design roles from a Material You palette, for the RN parts of the UI while
 * dynamic colour is on. The accent and the map colour stay fixed, like the
 * delay scale (semantic colours are not harmonised).
 */
export function rolesFromMaterial(
    m: MaterialRoles,
    fixed: ColorRoles,
): ColorRoles {
    return {
        canvas: m.surface,
        surface: m.surfaceContainerLow,
        surface2: m.surfaceContainerHigh,
        ink: m.onSurface,
        ink2: m.onSurfaceVariant,
        line: m.outlineVariant,
        action: m.primary,
        onAction: m.onPrimary,
        accent: fixed.accent,
        map: fixed.map,
    };
}
