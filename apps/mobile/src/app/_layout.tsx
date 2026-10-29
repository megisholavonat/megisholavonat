import { RADII } from "@megisholavonat/core/tokens";
import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform } from "react-native";
import { useTranslations } from "use-intl";
import { queryClient } from "../api";
import { I18nProvider } from "../i18n";
import "../notifications";
import { SettingsProvider } from "../settings/SettingsProvider";
import { AppThemeProvider, useAppTheme } from "../theme/ThemeProvider";
import { MNR2007_FONT } from "../train/RouteIcon";
import { liquidGlass } from "../ui/platform";

SplashScreen.preventAutoHideAsync();

const ios = Platform.OS === "ios";

/**
 * Peek · half · full (design board 2). Android allows at most three
 * detents, iOS any number; both use the native sheet.
 */
const TRAIN_DETENTS = [0.22, 0.5, 1];
/** Station board: half and full. */
const STATION_DETENTS = [0.6, 1];

function AppStack() {
    const theme = useAppTheme();
    const t = useTranslations();

    const sheet = {
        presentation: "formSheet",
        sheetGrabberVisible: true,
        sheetInitialDetentIndex: 0,
        // iOS 26 draws its own corners (and Liquid Glass) for system sheets
        sheetCornerRadius: ios ? undefined : RADII.sheetAndroid,
        sheetExpandsWhenScrolledToEdge: true,
        // Transparent on iOS 26 so the system Liquid Glass sheet shows through
        contentStyle: {
            backgroundColor: liquidGlass ? "transparent" : theme.colors.surface,
        },
    } as const;

    const header = {
        headerShown: true,
        headerTintColor: theme.colors.ink,
        headerStyle: ios ? undefined : { backgroundColor: theme.colors.canvas },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.colors.canvas },
    } as const;

    return (
        <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen
                name="train/[vehicleId]"
                // One sheet: tapping another train updates it
                dangerouslySingular={() => "train"}
                options={{
                    ...sheet,
                    sheetAllowedDetents: TRAIN_DETENTS,
                    // The map stays usable at peek and half; full dims it
                    sheetLargestUndimmedDetentIndex: 1,
                }}
            />
            <Stack.Screen
                name="station/[stationId]"
                dangerouslySingular={() => "station"}
                options={{
                    ...sheet,
                    sheetAllowedDetents: STATION_DETENTS,
                    sheetLargestUndimmedDetentIndex: 0,
                }}
            />
            <Stack.Screen
                name="search"
                options={{
                    ...header,
                    title: t("Search.title"),
                    presentation: ios ? "modal" : "card",
                }}
            />
            <Stack.Screen
                name="settings"
                options={{
                    ...header,
                    title: t("Settings.title"),
                    presentation: ios ? "modal" : "card",
                }}
            />
        </Stack>
    );
}

export default function RootLayout() {
    const [fontsLoaded, fontError] = useFonts({
        [MNR2007_FONT]: require("../../assets/fonts/MNR2007.ttf"),
    });
    const ready = fontsLoaded || !!fontError;

    useEffect(() => {
        if (ready) SplashScreen.hideAsync();
    }, [ready]);

    if (!ready) return null;

    return (
        <QueryClientProvider client={queryClient}>
            <SettingsProvider>
                <I18nProvider>
                    <AppThemeProvider>
                        <StatusBar style="auto" />
                        <AppStack />
                    </AppThemeProvider>
                </I18nProvider>
            </SettingsProvider>
        </QueryClientProvider>
    );
}
