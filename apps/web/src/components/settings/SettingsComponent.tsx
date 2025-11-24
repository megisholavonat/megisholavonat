"use client";

import { motion } from "motion/react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { FaCog } from "react-icons/fa";
import { FaInfo, FaTriangleExclamation } from "react-icons/fa6";
import ChangelogComponent from "@/components/settings/ChangelogComponent";
import ComputerBadge from "@/components/settings/ComputerBadge";
import { InfoBox } from "@/components/settings/InfoBox";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogOverlay,
    DialogPortal,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import NewFeature from "@/components/ui/NewFeature";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/useIsMobile";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Z_LAYERS } from "@/util/constants";
import { BASE_MAPS, type BaseMapKey } from "@/util/mapConfigs";

interface Settings {
    showTooltip: boolean;
    showStationNames: boolean;
    stationNamesOpacity: number;
    showTrains: boolean;
    showTramTrains: boolean;
    showHev: boolean;
    baseMap: BaseMapKey;
    showRailwayOverlay: boolean;
}

const defaultSettings: Settings = {
    showTooltip: true,
    showStationNames: true,
    stationNamesOpacity: 0.7,
    showTrains: true,
    showTramTrains: true,
    showHev: true,
    baseMap: "openstreetmap",
    showRailwayOverlay: true,
};

export default function SettingsComponent() {
    const t = useTranslations("SettingsComponent");
    const locale = useLocale();
    const router = useRouter();
    const pathname = usePathname();
    const { theme, setTheme } = useTheme();
    const [isOpen, setIsOpen] = useState(false);
    const [settings, setSettings] = useState<Settings>(defaultSettings);
    const [activeTab, setActiveTab] = useState("settings");
    const [changelogContent, setChangelogContent] = useState("");
    const isMobile = useIsMobile();

    // Separate state for UI slider to prevent lag
    const [sliderOpacity, setSliderOpacity] = useState(
        defaultSettings.stationNamesOpacity,
    );
    const opacityTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Load settings from localStorage on mount
    useEffect(() => {
        const loadSettings = () => {
            const storedSettings: Partial<Settings> = {};

            Object.keys(defaultSettings).forEach((key) => {
                const storedValue = localStorage.getItem(
                    `mhav.settings.${key}`,
                );
                if (storedValue !== null) {
                    const settingKey = key as keyof Settings;
                    if (settingKey === "stationNamesOpacity") {
                        storedSettings[settingKey] = parseFloat(storedValue);
                    } else if (settingKey === "baseMap") {
                        // Validate that the stored base map is valid
                        if (Object.keys(BASE_MAPS).includes(storedValue)) {
                            storedSettings[settingKey] =
                                storedValue as BaseMapKey;
                        }
                    } else {
                        storedSettings[settingKey] = storedValue === "true";
                    }
                }
            });

            const loadedSettings = { ...defaultSettings, ...storedSettings };

            // Auto-disable tooltip on mobile devices
            if (isMobile) {
                loadedSettings.showTooltip = false;
            }

            setSettings(loadedSettings);
            // Sync slider state with loaded opacity
            setSliderOpacity(loadedSettings.stationNamesOpacity);
        };

        loadSettings();
    }, [isMobile]);

    // Dispatch tooltip setting change event when mobile state affects tooltip
    useEffect(() => {
        const effectiveTooltipSetting = isMobile ? false : settings.showTooltip;
        window.dispatchEvent(
            new CustomEvent("tooltipSettingChanged", {
                detail: effectiveTooltipSetting,
            }),
        );
    }, [isMobile, settings.showTooltip]);

    // Load changelog content based on locale
    useEffect(() => {
        const loadChangelog = async () => {
            try {
                const response = await fetch(`/changelog-${locale}.md`);
                if (response.ok) {
                    const content = await response.text();
                    setChangelogContent(content);
                } else {
                    setChangelogContent(
                        `# ${t("tab_changelog")}\n\n${t("changelog_not_available")}`,
                    );
                }
            } catch (error) {
                console.error("Failed to load changelog:", error);
                setChangelogContent(
                    `# ${t("tab_changelog")}\n\n${t("changelog_not_available")}`,
                );
            }
        };

        loadChangelog();
    }, [locale, t]);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (opacityTimeoutRef.current) {
                clearTimeout(opacityTimeoutRef.current);
            }
        };
    }, []);

    // Debounced function to update opacity setting
    const debouncedUpdateOpacity = useCallback(
        (value: number) => {
            // Clear existing timeout
            if (opacityTimeoutRef.current) {
                clearTimeout(opacityTimeoutRef.current);
            }

            // Set new timeout
            opacityTimeoutRef.current = setTimeout(() => {
                localStorage.setItem(
                    "mhav.settings.stationNamesOpacity",
                    value.toString(),
                );
                const newSettings = { ...settings, stationNamesOpacity: value };
                setSettings(newSettings);

                // Dispatch event to update map
                window.dispatchEvent(
                    new CustomEvent("stationNamesOpacityChanged", {
                        detail: value,
                    }),
                );
            }, 300); // 300ms delay
        },
        [settings],
    );

    // Save individual setting to localStorage
    const updateSetting = (
        key: keyof Settings,
        value: boolean | number | BaseMapKey,
    ) => {
        // Don't allow tooltip changes on mobile - it's always disabled
        if (key === "showTooltip" && isMobile) {
            return;
        }

        // Handle opacity with debouncing
        if (key === "stationNamesOpacity") {
            setSliderOpacity(value as number); // Update UI immediately
            debouncedUpdateOpacity(value as number); // Update map with debounce
            return;
        }

        localStorage.setItem(`mhav.settings.${key}`, value.toString());
        const newSettings = { ...settings, [key]: value };
        setSettings(newSettings);

        // If showTooltip is changed, trigger a custom event for MapComponent
        if (key === "showTooltip") {
            window.dispatchEvent(
                new CustomEvent("tooltipSettingChanged", { detail: value }),
            );
        }

        // If showStationNames is changed, trigger a custom event for MapComponent
        if (key === "showStationNames") {
            window.dispatchEvent(
                new CustomEvent("stationNamesSettingChanged", {
                    detail: value,
                }),
            );
        }

        // If any vehicle type setting is changed, trigger a custom event for MapComponent
        if (
            key === "showTrains" ||
            key === "showTramTrains" ||
            key === "showHev"
        ) {
            window.dispatchEvent(
                new CustomEvent("vehicleTypeSettingsChanged", {
                    detail: {
                        showTrains:
                            key === "showTrains"
                                ? value
                                : newSettings.showTrains,
                        showTramTrains:
                            key === "showTramTrains"
                                ? value
                                : newSettings.showTramTrains,
                        showHev:
                            key === "showHev" ? value : newSettings.showHev,
                    },
                }),
            );
        }

        // If base map is changed, trigger a custom event for MapComponent
        if (key === "baseMap") {
            window.dispatchEvent(
                new CustomEvent("baseMapChanged", { detail: value }),
            );
        }

        // If railway overlay is changed, trigger a custom event for MapComponent
        if (key === "showRailwayOverlay") {
            window.dispatchEvent(
                new CustomEvent("railwayOverlayChanged", { detail: value }),
            );
        }
    };

    // Handle language change
    const handleLanguageChange = (checked: boolean) => {
        const newLocale = checked ? "en" : "hu";
        router.push(pathname, { locale: newLocale });
    };

    return (
        <div>
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogTrigger asChild>
                    <motion.button
                        className="w-10 h-10 rounded-lg flex cursor-pointer items-center hover:shadow-md justify-center text-gray-600 dark:text-white hover:text-blue-600 dark:hover:text-white hover:bg-blue-50 dark:hover:bg-black/95 transition-colors"
                        aria-label={t("settings_button")}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        transition={{
                            type: "spring",
                            stiffness: 400,
                            damping: 17,
                        }}
                    >
                        <motion.div transition={{ duration: 0.2 }}>
                            <FaCog className="w-5 h-5 dark:text-white" />
                        </motion.div>
                    </motion.button>
                </DialogTrigger>
                <DialogPortal>
                    <DialogOverlay style={{ zIndex: Z_LAYERS.DIALOGS }} />
                    <DialogContent
                        className="w-[90vw] max-w-[600px] h-[85vh] overflow-y-auto dark:bg-card/95"
                        style={{ zIndex: Z_LAYERS.DIALOGS + 1 }}
                        showCloseButton={true}
                    >
                        <Tabs
                            value={activeTab}
                            onValueChange={setActiveTab}
                            className="mt-6"
                        >
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger
                                    value="settings"
                                    className="cursor-pointer"
                                >
                                    {t("tab_settings")}
                                </TabsTrigger>
                                <TabsTrigger
                                    value="changelog"
                                    className="cursor-pointer"
                                >
                                    {t("tab_changelog")}
                                </TabsTrigger>
                            </TabsList>

                            <TabsContent
                                value="settings"
                                className="mt-6 space-y-6"
                            >
                                <InfoBox
                                    variant="warning"
                                    icon={FaTriangleExclamation}
                                >
                                    <div className="font-bold tracking-wide">
                                        {t("idk_where_the_trains_are")}
                                    </div>
                                </InfoBox>
                                <DialogHeader>
                                    <DialogTitle className="font-bold">
                                        {t("dialog_title")}
                                    </DialogTitle>
                                    <DialogDescription>
                                        {t("dialog_description")}
                                    </DialogDescription>
                                </DialogHeader>

                                {/* Language Switcher */}
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <p
                                            id="language-label"
                                            className="text-sm font-medium gap-x-3 flex items-center"
                                        >
                                            {t("language_label")}
                                        </p>
                                        <p
                                            id="language-description"
                                            className="text-sm text-muted-foreground"
                                        >
                                            {t("language_description")}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <Image
                                            src="https://purecatamphetamine.github.io/country-flag-icons/3x2/HU.svg"
                                            alt="Magyar"
                                            width={20}
                                            height={20}
                                            className={
                                                locale === "hu"
                                                    ? ""
                                                    : "opacity-50"
                                            }
                                        />
                                        <Switch
                                            checked={locale === "en"}
                                            onCheckedChange={
                                                handleLanguageChange
                                            }
                                            aria-labelledby="language-label"
                                            aria-describedby="language-description"
                                        />
                                        <Image
                                            src="https://purecatamphetamine.github.io/country-flag-icons/3x2/GB.svg"
                                            alt="English"
                                            width={20}
                                            height={20}
                                            className={
                                                locale === "en"
                                                    ? ""
                                                    : "opacity-50"
                                            }
                                        />
                                    </div>
                                </div>

                                {/* Theme Switcher */}
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <div className="flex items-center gap-x-3">
                                            <p
                                                id="theme-label"
                                                className="text-sm font-medium gap-x-3 flex items-center"
                                            >
                                                {t("theme_label")}
                                            </p>
                                            <NewFeature />
                                        </div>

                                        <p
                                            id="theme-description"
                                            className="text-sm text-muted-foreground"
                                        >
                                            {t("theme_description")}
                                        </p>
                                    </div>
                                    <Select
                                        value={theme || "system"}
                                        onValueChange={(value) =>
                                            setTheme(value)
                                        }
                                    >
                                        <SelectTrigger
                                            aria-labelledby="theme-label"
                                            aria-describedby="theme-description"
                                        >
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent
                                            style={{
                                                zIndex: Z_LAYERS.DIALOG_SELECT,
                                            }}
                                        >
                                            <SelectItem value="light">
                                                {t("theme_light")}
                                            </SelectItem>
                                            <SelectItem value="dark">
                                                {t("theme_dark")}
                                            </SelectItem>
                                            <SelectItem value="system">
                                                {t("theme_system")}
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Tooltip Setting */}
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <p
                                            id="tooltip-label"
                                            className="text-sm font-medium gap-x-3 flex items-center"
                                        >
                                            {t("tooltip_label")}
                                            <ComputerBadge />
                                        </p>
                                        <p
                                            id="tooltip-description"
                                            className="text-sm text-muted-foreground"
                                        >
                                            {t("tooltip_description")}
                                        </p>
                                    </div>
                                    <Switch
                                        checked={settings.showTooltip}
                                        disabled={isMobile}
                                        onCheckedChange={(checked) =>
                                            updateSetting(
                                                "showTooltip",
                                                checked,
                                            )
                                        }
                                        aria-labelledby="tooltip-label"
                                        aria-describedby="tooltip-description"
                                    />
                                </div>

                                {/* Station Names Setting */}
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <p
                                            id="station-names-label"
                                            className="text-sm font-medium"
                                        >
                                            {t("station_names_label")}
                                        </p>
                                        <p
                                            id="station-names-description"
                                            className="text-sm text-muted-foreground"
                                        >
                                            {t("station_names_description")}
                                        </p>
                                    </div>
                                    <Switch
                                        checked={settings.showStationNames}
                                        onCheckedChange={(checked) =>
                                            updateSetting(
                                                "showStationNames",
                                                checked,
                                            )
                                        }
                                        aria-labelledby="station-names-label"
                                        aria-describedby="station-names-description"
                                    />
                                </div>

                                {/* Station Names Opacity Setting */}
                                <div className="space-y-4">
                                    <div className="space-y-0.5">
                                        <p
                                            id="station-opacity-label"
                                            className={`text-sm font-medium ${
                                                !settings.showStationNames
                                                    ? "text-muted-foreground"
                                                    : ""
                                            }`}
                                        >
                                            {t("station_names_opacity_label")}
                                        </p>
                                        <p
                                            id="station-opacity-description"
                                            className={`text-sm text-muted-foreground ${
                                                !settings.showStationNames
                                                    ? "opacity-50"
                                                    : ""
                                            }`}
                                        >
                                            {t(
                                                "station_names_opacity_description",
                                            )}
                                        </p>
                                    </div>
                                    <div className="flex items-center space-x-4">
                                        <span
                                            id="station-opacity-value"
                                            className={`text-xs ${
                                                !settings.showStationNames
                                                    ? "text-muted-foreground"
                                                    : ""
                                            }`}
                                        >
                                            {Math.round(sliderOpacity * 100)}%
                                        </span>
                                        <Slider
                                            value={[
                                                Math.round(sliderOpacity * 100),
                                            ]}
                                            onValueChange={(values) =>
                                                updateSetting(
                                                    "stationNamesOpacity",
                                                    values[0] / 100,
                                                )
                                            }
                                            min={5}
                                            max={100}
                                            step={5}
                                            disabled={
                                                !settings.showStationNames
                                            }
                                            className="flex-1"
                                            aria-labelledby="station-opacity-label"
                                            aria-describedby="station-opacity-description"
                                            aria-valuetext={`${Math.round(sliderOpacity * 100)}%`}
                                        />
                                    </div>
                                </div>

                                {/* Vehicle Type Toggles */}
                                <fieldset className="space-y-4 border-0 p-0 m-0">
                                    <legend className="font-bold text-lg">
                                        {t("vehicle_types_title")}
                                    </legend>

                                    {/* Trains Toggle */}
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <p
                                                id="trains-label"
                                                className="text-sm font-medium"
                                            >
                                                {t("trains_label")}
                                            </p>
                                            <p
                                                id="trains-description"
                                                className="text-sm text-muted-foreground"
                                            >
                                                {t("trains_description")}
                                            </p>
                                        </div>
                                        <Switch
                                            checked={settings.showTrains}
                                            onCheckedChange={(checked) =>
                                                updateSetting(
                                                    "showTrains",
                                                    checked,
                                                )
                                            }
                                            aria-labelledby="trains-label"
                                            aria-describedby="trains-description"
                                        />
                                    </div>

                                    {/* Tram-Trains Toggle */}
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <p
                                                id="tramtrains-label"
                                                className="text-sm font-medium"
                                            >
                                                {t("tramtrains_label")}
                                            </p>
                                            <p
                                                id="tramtrains-description"
                                                className="text-sm text-muted-foreground"
                                            >
                                                {t("tramtrains_description")}
                                            </p>
                                        </div>
                                        <Switch
                                            checked={settings.showTramTrains}
                                            onCheckedChange={(checked) =>
                                                updateSetting(
                                                    "showTramTrains",
                                                    checked,
                                                )
                                            }
                                            aria-labelledby="tramtrains-label"
                                            aria-describedby="tramtrains-description"
                                        />
                                    </div>

                                    {/* HEV Toggle */}
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <p
                                                id="hev-label"
                                                className="text-sm font-medium"
                                            >
                                                {t("hev_label")}
                                            </p>
                                            <p
                                                id="hev-description"
                                                className="text-sm text-muted-foreground"
                                            >
                                                {t("hev_description")}
                                            </p>
                                        </div>
                                        <Switch
                                            checked={settings.showHev}
                                            onCheckedChange={(checked) =>
                                                updateSetting(
                                                    "showHev",
                                                    checked,
                                                )
                                            }
                                            aria-labelledby="hev-label"
                                            aria-describedby="hev-description"
                                        />
                                    </div>
                                </fieldset>

                                {/* Map Settings */}
                                <fieldset className="space-y-4 border-0 p-0 m-0">
                                    <legend className="font-bold text-lg gap-x-3 flex">
                                        {t("map_settings_title")}
                                        <NewFeature />
                                    </legend>

                                    {/* Base Map Selector */}
                                    <div className="space-y-2">
                                        <div className="space-y-0.5">
                                            <p
                                                id="base-map-label"
                                                className="text-sm font-medium"
                                            >
                                                {t("base_map_label")}
                                            </p>
                                        </div>
                                        <Select
                                            value={settings.baseMap}
                                            onValueChange={(value) =>
                                                updateSetting(
                                                    "baseMap",
                                                    value as BaseMapKey,
                                                )
                                            }
                                        >
                                            <SelectTrigger
                                                className="w-full"
                                                aria-labelledby="base-map-label"
                                            >
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent
                                                style={{
                                                    zIndex: Z_LAYERS.DIALOG_SELECT,
                                                }}
                                            >
                                                {Object.entries(BASE_MAPS).map(
                                                    ([key]) => (
                                                        <SelectItem
                                                            key={key}
                                                            value={key}
                                                        >
                                                            {
                                                                BASE_MAPS[key]
                                                                    .name
                                                            }
                                                        </SelectItem>
                                                    ),
                                                )}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {/* Railway Overlay Toggle */}
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <p
                                                id="railway-overlay-label"
                                                className="text-sm font-medium"
                                            >
                                                {t("railway_overlay_label")}
                                            </p>
                                        </div>
                                        <Switch
                                            checked={
                                                settings.showRailwayOverlay
                                            }
                                            onCheckedChange={(checked) =>
                                                updateSetting(
                                                    "showRailwayOverlay",
                                                    checked,
                                                )
                                            }
                                            aria-labelledby="railway-overlay-label"
                                        />
                                    </div>
                                </fieldset>
                            </TabsContent>

                            <TabsContent
                                value="changelog"
                                className="mt-6 space-y-6"
                            >
                                <InfoBox variant="info" icon={FaInfo}>
                                    <div className="font-bold tracking-wide">
                                        {t("hobby_project_notice")}
                                    </div>
                                </InfoBox>
                                <ChangelogComponent
                                    content={changelogContent}
                                />
                            </TabsContent>
                        </Tabs>
                    </DialogContent>
                </DialogPortal>
            </Dialog>
        </div>
    );
}
