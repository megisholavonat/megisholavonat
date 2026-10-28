import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { queryClient } from "../api";
import { I18nProvider } from "../i18n";
import "../notifications";
import { MNR2007_FONT } from "../train/RouteIcon";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
    const colorScheme = useColorScheme();
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
            <I18nProvider>
                <ThemeProvider
                    value={colorScheme === "dark" ? DarkTheme : DefaultTheme}
                >
                    <StatusBar style="auto" />
                    <Stack screenOptions={{ headerShown: false }}>
                        <Stack.Screen name="index" />
                        <Stack.Screen
                            name="train/[vehicleId]"
                            // One sheet: tapping another train updates it.
                            dangerouslySingular={() => "train"}
                            options={{
                                presentation: "formSheet",
                                sheetAllowedDetents: [0.25, 0.6],
                                sheetInitialDetentIndex: 0,
                                sheetLargestUndimmedDetentIndex: 0,
                                sheetGrabberVisible: true,
                                sheetCornerRadius: 24,
                            }}
                        />
                    </Stack>
                </ThemeProvider>
            </I18nProvider>
        </QueryClientProvider>
    );
}
