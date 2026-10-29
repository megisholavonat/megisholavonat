import type { ColorScheme } from "@megisholavonat/core/tokens";
import type { MaterialRoles } from "./palette";

// Dynamic colour is Android only (dynamicColor.android.ts).

export const dynamicColorSupported = false;

export function dynamicPalette(_scheme: ColorScheme): MaterialRoles | null {
    return null;
}
