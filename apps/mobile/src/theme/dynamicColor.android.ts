import {
    getMaterialColors,
    isDynamicColorAvailable,
} from "@expo/ui/jetpack-compose";
import type { ColorScheme } from "@megisholavonat/core/tokens";
import type { MaterialRoles } from "./palette";

/** Android 12+ wallpaper colours (Material You). */
export const dynamicColorSupported = isDynamicColorAvailable;

export function dynamicPalette(scheme: ColorScheme): MaterialRoles | null {
    return isDynamicColorAvailable ? getMaterialColors({ scheme }) : null;
}
