import type { ColorScheme } from "@megisholavonat/core/tokens";
import {
    type NativeTheme,
    nativeTheme,
} from "@megisholavonat/core/tokens/native";
import {
    DarkTheme,
    DefaultTheme,
    ThemeProvider as NavigationThemeProvider,
} from "expo-router";
import {
    createContext,
    type ReactNode,
    useContext,
    useEffect,
    useMemo,
} from "react";
import { Appearance, useColorScheme } from "react-native";
import { useSettings } from "../settings/SettingsProvider";
import { dynamicPalette } from "./dynamicColor";
import { rolesFromMaterial } from "./palette";

export interface AppTheme extends NativeTheme {
    /** Android Material You colours are in use */
    dynamic: boolean;
}

const ThemeContext = createContext<AppTheme>({
    ...nativeTheme("light"),
    dynamic: false,
});

export function buildTheme(scheme: ColorScheme, dynamic: boolean): AppTheme {
    const base = nativeTheme(scheme);
    const palette = dynamic ? dynamicPalette(scheme) : null;
    if (!palette) return { ...base, dynamic: false };
    return {
        ...base,
        colors: rolesFromMaterial(palette, base.colors),
        dynamic: true,
    };
}

/**
 * Design tokens for the current scheme. The theme setting overrides the
 * system appearance app-wide (native sheets and controls follow it too).
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
    const { settings } = useSettings();

    useEffect(() => {
        Appearance.setColorScheme(
            settings.theme === "system" ? "unspecified" : settings.theme,
        );
    }, [settings.theme]);

    const scheme: ColorScheme = useColorScheme() === "dark" ? "dark" : "light";
    const theme = useMemo(
        () => buildTheme(scheme, settings.dynamicColor),
        [scheme, settings.dynamicColor],
    );

    const navigationTheme = useMemo(() => {
        const base = theme.dark ? DarkTheme : DefaultTheme;
        return {
            ...base,
            colors: {
                ...base.colors,
                primary: theme.colors.action,
                background: theme.colors.canvas,
                card: theme.colors.surface,
                text: theme.colors.ink,
                border: theme.colors.line,
            },
        };
    }, [theme]);

    return (
        <ThemeContext.Provider value={theme}>
            <NavigationThemeProvider value={navigationTheme}>
                {children}
            </NavigationThemeProvider>
        </ThemeContext.Provider>
    );
}

export function useAppTheme(): AppTheme {
    return useContext(ThemeContext);
}
