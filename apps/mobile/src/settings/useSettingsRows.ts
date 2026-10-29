import type { Locale } from "@megisholavonat/core/i18n";
import * as WebBrowser from "expo-web-browser";
import { useLocale, useTranslations } from "use-intl";
import { track } from "../analytics";
import { API_URL, PROD_API_URL, SOURCE_URL, WEB_URL } from "../config";
import { useDeleteData } from "../privacy/useDeleteData";
import { useSettings } from "./SettingsProvider";
import {
    type LanguagePreference,
    type Settings,
    STATION_NAMES_OPACITY,
    stationNamesOpacity,
    type ThemePreference,
} from "./settings";

/** The map's switches, each with its name in the `settings_changed` event */
const MAP_SWITCHES = {
    showStationNames: "station_names",
    animateVehicles: "animate_vehicles",
    showTrains: "trains",
    showHev: "hev",
    showTramTrains: "tram_trains",
} as const satisfies Partial<Record<keyof Settings, string>>;
export type MapSwitch = keyof typeof MAP_SWITCHES;

const OSM_COPYRIGHT = "https://www.openstreetmap.org/copyright";
const ORM_COPYRIGHT = "https://www.openrailwaymap.org/";

/** Language names stay in their own language, as in system pickers. */
const LANGUAGE_NAMES: Record<Locale, string> = {
    hu: "Magyar",
    en: "English",
};

/** The data behind both settings screens (SwiftUI and Compose). */
export function useSettingsRows() {
    const t = useTranslations("Settings");
    const { settings, update } = useSettings();
    const { deleting, deleteData } = useDeleteData();
    const locale = useLocale();

    const languages: { value: string; label: string }[] = [
        { value: "system", label: t("system") },
        ...(Object.keys(LANGUAGE_NAMES) as Locale[]).map((code) => ({
            value: code,
            label: LANGUAGE_NAMES[code],
        })),
    ];
    const themes: { value: ThemePreference; label: string }[] = [
        { value: "system", label: t("system") },
        { value: "light", label: t("theme_light") },
        { value: "dark", label: t("theme_dark") },
    ];

    return {
        t,
        settings,
        languages,
        language: settings.language ?? "system",
        setLanguage: (value: string) => {
            track("settings_changed", {
                key: "language",
                value: value as "hu" | "en" | "system",
            });
            update({
                language:
                    value === "system" ? null : (value as LanguagePreference),
            });
        },
        themes,
        setTheme: (theme: ThemePreference) => {
            track("settings_changed", { key: "theme", value: theme });
            update({ theme });
        },
        setDynamicColor: (dynamicColor: boolean) => {
            track("settings_changed", {
                key: "dynamic_color",
                value: dynamicColor ? "on" : "off",
            });
            update({ dynamicColor });
        },
        setDetailedRailwayMap: (detailedRailwayMap: boolean) => {
            track("settings_changed", {
                key: "railway_layer",
                value: detailedRailwayMap ? "on" : "off",
            });
            update({ detailedRailwayMap });
        },
        setMapSwitch: (key: MapSwitch, on: boolean) => {
            track("settings_changed", {
                key: MAP_SWITCHES[key],
                value: on ? "on" : "off",
            });
            update({ [key]: on });
        },
        opacityRange: STATION_NAMES_OPACITY,
        /** While dragging the map follows; the event waits for the end */
        setStationNamesOpacity: (value: number) =>
            update({
                stationNamesOpacity: stationNamesOpacity(
                    value,
                    settings.stationNamesOpacity,
                ),
            }),
        commitStationNamesOpacity: () =>
            track("settings_changed", { key: "station_names_opacity" }),
        setAnalytics: (granted: boolean) => {
            track(
                "consent_decided",
                {
                    decision: granted ? "granted" : "denied",
                    source: "settings",
                },
                { instant: true },
            );
            update({ analytics: granted ? "granted" : "denied" });
        },
        openMapData: () => WebBrowser.openBrowserAsync(OSM_COPYRIGHT),
        openRailwayData: () => WebBrowser.openBrowserAsync(ORM_COPYRIGHT),
        openSource: () => WebBrowser.openBrowserAsync(SOURCE_URL),
        deleting,
        deleteData,
        /**
         * Which API the app talks to, in development builds and in any build
         * not on production (beta). Never shown in production builds.
         */
        devApiUrl: __DEV__ || API_URL !== PROD_API_URL ? API_URL : null,
        openPrivacy: () =>
            WebBrowser.openBrowserAsync(`${WEB_URL}/${locale}/privacy`),
    };
}
