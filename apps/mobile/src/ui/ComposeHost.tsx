import { Host, type HostProps } from "@expo/ui/jetpack-compose";
import { useMemo } from "react";
import { materialOverrides } from "../theme/palette";
import { useAppTheme } from "../theme/ThemeProvider";

/**
 * Jetpack Compose host themed like the rest of the app: the fixed neutral
 * Material scheme, or the wallpaper colours when dynamic colour is on.
 * Android only.
 */
export function ComposeHost(props: Omit<HostProps, "colorScheme">) {
    const theme = useAppTheme();
    const overrides = useMemo(
        () => (theme.dynamic ? undefined : materialOverrides(theme.colors)),
        [theme],
    );
    return (
        <Host
            {...props}
            colorScheme={theme.scheme}
            colorOverrides={overrides}
        />
    );
}
