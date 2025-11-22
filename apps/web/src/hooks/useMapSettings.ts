import { useEffect, useState } from "react";
import { BASE_MAPS, type BaseMapKey } from "@/util/mapConfigs";
import { useIsMobile } from "./useIsMobile";

interface VehicleTypeSettings {
    showTrains: boolean;
    showTramTrains: boolean;
    showHev: boolean;
}

export function useMapSettings() {
    const [showTooltip, setShowTooltip] = useState(true);
    const [showStationNames, setShowStationNames] = useState(true);
    const [stationNamesOpacity, setStationNamesOpacity] = useState(0.9);
    const [vehicleTypeSettings, setVehicleTypeSettings] =
        useState<VehicleTypeSettings>({
            showTrains: true,
            showTramTrains: true,
            showHev: true,
        });
    const [baseMap, setBaseMap] = useState<BaseMapKey>("openstreetmap");
    const [showRailwayOverlay, setShowRailwayOverlay] = useState(true);
    const isMobile = useIsMobile();

    // Load settings from localStorage
    useEffect(() => {
        const storedTooltip = localStorage.getItem("mhav.settings.showTooltip");
        const tooltipSetting =
            storedTooltip !== null ? storedTooltip === "true" : true;

        // Auto-disable tooltip on mobile devices
        setShowTooltip(isMobile ? false : tooltipSetting);

        // Load station names setting
        const storedStationNames = localStorage.getItem(
            "mhav.settings.showStationNames",
        );
        const stationNamesSetting =
            storedStationNames !== null ? storedStationNames === "true" : true;
        setShowStationNames(stationNamesSetting);

        // Load station names opacity setting
        const storedStationNamesOpacity = localStorage.getItem(
            "mhav.settings.stationNamesOpacity",
        );
        const stationNamesOpacitySetting =
            storedStationNamesOpacity !== null
                ? parseFloat(storedStationNamesOpacity)
                : 0.9;
        setStationNamesOpacity(stationNamesOpacitySetting);

        // Load vehicle type settings
        const storedTrains = localStorage.getItem("mhav.settings.showTrains");
        const storedTramTrains = localStorage.getItem(
            "mhav.settings.showTramTrains",
        );
        const storedHev = localStorage.getItem("mhav.settings.showHev");

        setVehicleTypeSettings({
            showTrains: storedTrains !== null ? storedTrains === "true" : true,
            showTramTrains:
                storedTramTrains !== null ? storedTramTrains === "true" : true,
            showHev: storedHev !== null ? storedHev === "true" : true,
        });

        // Load base map setting
        const storedBaseMap = localStorage.getItem("mhav.settings.baseMap");
        if (storedBaseMap && Object.keys(BASE_MAPS).includes(storedBaseMap)) {
            setBaseMap(storedBaseMap as BaseMapKey);
        }

        // Load railway overlay setting
        const storedRailwayOverlay = localStorage.getItem(
            "mhav.settings.showRailwayOverlay",
        );
        const railwayOverlaySetting =
            storedRailwayOverlay !== null
                ? storedRailwayOverlay === "true"
                : true;
        setShowRailwayOverlay(railwayOverlaySetting);
    }, [isMobile]);

    // Listen for tooltip setting changes
    useEffect(() => {
        const handleTooltipSettingChange = (event: CustomEvent<boolean>) => {
            // Override to false on mobile devices regardless of setting
            setShowTooltip(isMobile ? false : event.detail);
        };

        window.addEventListener(
            "tooltipSettingChanged",
            handleTooltipSettingChange as EventListener,
        );
        return () => {
            window.removeEventListener(
                "tooltipSettingChanged",
                handleTooltipSettingChange as EventListener,
            );
        };
    }, [isMobile]);

    // Listen for station names setting changes
    useEffect(() => {
        const handleStationNamesSettingChange = (
            event: CustomEvent<boolean>,
        ) => {
            setShowStationNames(event.detail);
        };

        window.addEventListener(
            "stationNamesSettingChanged",
            handleStationNamesSettingChange as EventListener,
        );
        return () => {
            window.removeEventListener(
                "stationNamesSettingChanged",
                handleStationNamesSettingChange as EventListener,
            );
        };
    }, []);

    // Listen for station names opacity setting changes
    useEffect(() => {
        const handleStationNamesOpacityChange = (
            event: CustomEvent<number>,
        ) => {
            setStationNamesOpacity(event.detail);
        };

        window.addEventListener(
            "stationNamesOpacityChanged",
            handleStationNamesOpacityChange as EventListener,
        );
        return () => {
            window.removeEventListener(
                "stationNamesOpacityChanged",
                handleStationNamesOpacityChange as EventListener,
            );
        };
    }, []);

    // Listen for vehicle type setting changes
    useEffect(() => {
        const handleVehicleTypeSettingChange = (
            event: CustomEvent<VehicleTypeSettings>,
        ) => {
            setVehicleTypeSettings(event.detail);
        };

        window.addEventListener(
            "vehicleTypeSettingsChanged",
            handleVehicleTypeSettingChange as EventListener,
        );
        return () => {
            window.removeEventListener(
                "vehicleTypeSettingsChanged",
                handleVehicleTypeSettingChange as EventListener,
            );
        };
    }, []);

    // Listen for base map setting changes
    useEffect(() => {
        const handleBaseMapChange = (event: CustomEvent<BaseMapKey>) => {
            setBaseMap(event.detail);
        };

        window.addEventListener(
            "baseMapChanged",
            handleBaseMapChange as EventListener,
        );
        return () => {
            window.removeEventListener(
                "baseMapChanged",
                handleBaseMapChange as EventListener,
            );
        };
    }, []);

    // Listen for railway overlay setting changes
    useEffect(() => {
        const handleRailwayOverlayChange = (event: CustomEvent<boolean>) => {
            setShowRailwayOverlay(event.detail);
        };

        window.addEventListener(
            "railwayOverlayChanged",
            handleRailwayOverlayChange as EventListener,
        );
        return () => {
            window.removeEventListener(
                "railwayOverlayChanged",
                handleRailwayOverlayChange as EventListener,
            );
        };
    }, []);

    return {
        showTooltip,
        showStationNames,
        stationNamesOpacity,
        vehicleTypeSettings,
        baseMap,
        showRailwayOverlay,
    };
}
