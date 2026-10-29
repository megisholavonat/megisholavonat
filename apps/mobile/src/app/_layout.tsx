import { RADII } from "@megisholavonat/core/tokens";
import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { useLastNotificationResponse } from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform } from "react-native";
import { useLocale, useTranslations } from "use-intl";
import { queryClient } from "../api";
import { getFollows } from "../follow/store";
import { syncFollows } from "../follow/sync";
import { I18nProvider } from "../i18n";
import { notificationTarget } from "../notifications";
import { SettingsProvider } from "../settings/SettingsProvider";
import { AppThemeProvider, useAppTheme } from "../theme/ThemeProvider";
import { MNR2007_FONT } from "../train/RouteIcon";
import { liquidGlass } from "../ui/platform";
import { useAnalytics } from "../useAnalytics";

SplashScreen.preventAutoHideAsync();

// A link or an alert straight to a train or station still opens over the
// map, so closing its sheet goes back to the map rather than nowhere
export const unstable_settings = { anchor: "index" };

const ios = Platform.OS === "ios";

/**
 * Peek · half · full (design board 2). Android allows at most three
 * detents, iOS any number; both use the native sheet.
 */
const TRAIN_DETENTS = [0.22, 0.5, 1];
/** Station board: half and full. */
const STATION_DETENTS = [0.6, 1];
/** Search on iOS: medium (map in view) and large (typing). */
const SEARCH_DETENTS = [0.55, 1];

/** Notifications already routed, so a re-render doesn't open them again */
const routedNotifications = new Set<string>();

/**
 * A tapped alert opens its train's sheet, also on a cold start. The consent
 * card stays away on such a launch (see SettingsProvider).
 */
function useNotificationRouting() {
    const response = useLastNotificationResponse();
    const router = useRouter();
    useEffect(() => {
        if (!response) return;
        const id = response.notification.request.identifier;
        if (routedNotifications.has(id)) return;
        routedNotifications.add(id);
        const target = notificationTarget(response);
        // Older alerts carry only the follow: its last known vehicle
        const vehicleId =
            target.vehicleId ??
            getFollows().find((f) => f.id === target.followId)?.vehicleId;
        if (vehicleId) {
            router.push({
                pathname: "/train/[vehicleId]",
                params: { vehicleId },
            });
        }
    }, [response, router]);
}

function AppStack() {
    const theme = useAppTheme();
    const t = useTranslations();
    const locale = useLocale();
    useNotificationRouting();
    useAnalytics();

    // Brings the API in step with the follows on this device, once a launch
    useEffect(() => {
        syncFollows(locale);
    }, [locale]);

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
                // iOS: a sheet over the map (Apple Maps), large while
                // typing, medium with the map usable above it. Android: the
                // full-screen Material search in the app bar.
                options={
                    ios
                        ? {
                              ...sheet,
                              sheetAllowedDetents: SEARCH_DETENTS,
                              sheetInitialDetentIndex: 1,
                              sheetLargestUndimmedDetentIndex: 0,
                          }
                        : {
                              ...header,
                              title: t("Search.title"),
                              presentation: "card",
                          }
                }
            />
            <Stack.Screen
                name="trains"
                options={{
                    ...header,
                    title: t("Trains.title"),
                    presentation: ios ? "modal" : "card",
                }}
            />
            <Stack.Screen
                name="disruptions"
                options={{
                    ...header,
                    title: t("Disruptions.title"),
                    presentation: ios ? "modal" : "card",
                }}
            />
            <Stack.Screen
                name="follow"
                options={{
                    ...header,
                    title: t("Follow.title"),
                    presentation: ios ? "modal" : "card",
                }}
            />
            <Stack.Screen
                name="journey/index"
                options={{ ...header, title: t("Journey.title") }}
            />
            <Stack.Screen
                name="journey/pick"
                options={{
                    ...header,
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
