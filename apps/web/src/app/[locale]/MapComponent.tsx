import type { ApiResponse } from "@megisholavonat/api-client";
import { AnimatePresence, motion } from "motion/react";
import { useQueryState } from "nuqs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer } from "react-leaflet";
import { DelayLegend } from "@/components/information/DelayLegend";
import { DragCloseDrawer } from "@/components/information/DragModal";
import { NoDataDialog } from "@/components/information/NoDataDialog";
import { TrainPanel } from "@/components/information/TrainPanel";
import { MapController } from "@/components/map/MapController";
import { MapLayers } from "@/components/map/MapLayers";
import { StopMarkers } from "@/components/map/StopMarkers";
import { TrainMarkers } from "@/components/map/TrainMarkers";
import { TrainPolyline } from "@/components/map/TrainPolyline";
import { UserLocation } from "@/components/map/UserLocation";
import { ZoomButtons } from "@/components/map/ZoomButtons";
import { useMapSettings } from "@/hooks/useMapSettings";
import { Z_LAYERS } from "@/util/constants";
import { vehicleType } from "@/util/vehicle";
import type { SearchSelection } from "./page";

// Animation variants for desktop (slide from right)
const desktopVariants = {
    hidden: {
        x: "100%",
        opacity: 0,
    },
    visible: {
        x: 0,
        opacity: 1,
        transition: {
            type: "spring" as const,
            damping: 30,
            stiffness: 300,
            opacity: { duration: 0.3 },
        },
    },
    exit: {
        x: "100%",
        opacity: 0,
        transition: {
            type: "spring" as const,
            damping: 30,
            stiffness: 300,
            opacity: { duration: 0.2 },
        },
    },
};

export default function MapComponent({
    searchSelection,
    onClearSearchSelection,
    data,
}: {
    searchSelection: SearchSelection | null;
    onClearSearchSelection?: () => void;
    data: ApiResponse | undefined;
}) {
    const [selectedVehicleId, setSelectedVehicleId] =
        useQueryState("vehicleId");
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [showNoDataDialog, setShowNoDataDialog] = useState(false);

    // Use settings hook
    const {
        showTooltip,
        showStationNames,
        stationNamesOpacity,
        vehicleTypeSettings,
        baseMap,
        showRailwayOverlay,
    } = useMapSettings();

    // handle updating search selection
    useEffect(() => {
        if (searchSelection) {
            setSelectedVehicleId(searchSelection.vehicleId);
            setIsPanelOpen(true);
        }
    }, [searchSelection, setSelectedVehicleId]);

    const handleClosePanel = useCallback(() => {
        setIsPanelOpen(false);
        setSelectedVehicleId(null);
    }, [setSelectedVehicleId]);

    // Handle escape key to close panel
    useEffect(() => {
        const handleEscapeKey = (event: KeyboardEvent) => {
            if (event.key === "Escape" && isPanelOpen) {
                handleClosePanel();
            }
        };

        document.addEventListener("keydown", handleEscapeKey);
        return () => {
            document.removeEventListener("keydown", handleEscapeKey);
        };
    }, [isPanelOpen, handleClosePanel]);

    // Memoize selected train to prevent unnecessary recalculations
    const selectedTrain = useMemo(
        () =>
            selectedVehicleId !== null && data?.locations
                ? data.locations.find(
                      (train) => train.vehicleId === selectedVehicleId,
                  )
                : null,
        [selectedVehicleId, data?.locations],
    );

    // Memoize filtered trains to prevent unnecessary recalculations
    const filteredTrains = useMemo(
        () =>
            data?.locations.filter((train) => {
                const type = vehicleType(train);
                switch (type) {
                    case "train":
                        return vehicleTypeSettings.showTrains;
                    case "tramtrain":
                        return vehicleTypeSettings.showTramTrains;
                    case "hev":
                        return vehicleTypeSettings.showHev;
                    default:
                        return true;
                }
            }) ?? [],
        [data?.locations, vehicleTypeSettings],
    );

    // Show dialog only when no data is received OR data is >= 15 minutes old AND no trains
    useEffect(() => {
        const hasTrains = filteredTrains.length > 0;
        const isVeryOld =
            data?.dataAgeMinutes !== undefined &&
            data.dataAgeMinutes !== null &&
            data.dataAgeMinutes >= 15;

        if (data?.noDataReceived || (isVeryOld && !hasTrains)) {
            setShowNoDataDialog(true);
        } else {
            setShowNoDataDialog(false);
        }
    }, [data?.noDataReceived, data?.dataAgeMinutes, filteredTrains.length]);

    // Handle train marker click
    const handleTrainClick = (vehicleId: string) => {
        // Clear search selection when clicking directly on map
        onClearSearchSelection?.();

        if (selectedVehicleId === vehicleId) {
            // Same train clicked - toggle panel
            setIsPanelOpen(!isPanelOpen);
        } else {
            // Different train clicked - select new train and open panel
            setSelectedVehicleId(vehicleId);
            setIsPanelOpen(true);
        }
    };

    return (
        <div className="relative h-full bg-background">
            {/* Map Container */}
            <div className="h-full w-full bg-background">
                <MapContainer
                    center={[47.16, 19.5]}
                    zoom={8}
                    scrollWheelZoom={true}
                    zoomControl={false}
                    style={{ height: "100%", width: "100%" }}
                    className="bg-background"
                >
                    <MapLayers
                        baseMap={baseMap}
                        showRailwayOverlay={showRailwayOverlay}
                    />

                    <TrainPolyline selectedTrain={selectedTrain ?? null} />

                    <TrainMarkers
                        trains={filteredTrains}
                        selectedVehicleId={selectedVehicleId}
                        onTrainClick={handleTrainClick}
                        showTooltip={showTooltip}
                    />

                    {selectedTrain && (
                        <StopMarkers
                            selectedTrain={selectedTrain}
                            showStationNames={showStationNames}
                            stationNamesOpacity={stationNamesOpacity}
                        />
                    )}

                    {/* Zoom buttons */}
                    <ZoomButtons />

                    {/* User location functionality */}
                    <UserLocation />

                    {/* Map Controller */}
                    <MapController
                        selectedTrain={selectedTrain ?? undefined}
                        searchSelection={searchSelection ?? undefined}
                        isPanelOpen={isPanelOpen}
                    />
                </MapContainer>
            </div>

            {/* Floating Delay Legend */}
            <AnimatePresence>
                {!isPanelOpen && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        transition={{
                            duration: 0.3,
                            ease: "easeOut",
                        }}
                        className="absolute bottom-4 right-4"
                        style={{ zIndex: Z_LAYERS.MAP_CONTROLS }}
                    >
                        <DelayLegend
                            dataAgeMinutes={data?.dataAgeMinutes ?? undefined}
                            hasTrains={filteredTrains.length > 0}
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Stops Table Panel - Desktop (Right Side) */}
            <div className="hidden md:block overflow-hidden">
                <AnimatePresence>
                    {isPanelOpen && selectedTrain && (
                        <motion.div
                            className="md:w-1/2 lg:w-1/3 rounded-l-3xl bg-white border-l border-gray-300 overflow-hidden flex-col fixed right-0 top-0 h-full shadow-2xl"
                            style={{ zIndex: Z_LAYERS.PANELS }}
                            variants={desktopVariants}
                            initial="hidden"
                            animate="visible"
                            exit="exit"
                        >
                            <TrainPanel
                                vehiclePosition={selectedTrain}
                                onClose={handleClosePanel}
                                showCloseButton={true}
                            />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Stops Table Panel - Mobile */}
            <div
                className="md:hidden fixed bottom-0 left-0 right-0"
                style={{ zIndex: Z_LAYERS.PANELS }}
            >
                <DragCloseDrawer open={isPanelOpen} setOpen={handleClosePanel}>
                    {selectedTrain && (
                        <TrainPanel
                            vehiclePosition={selectedTrain}
                            showCloseButton={false}
                        />
                    )}
                </DragCloseDrawer>
            </div>

            {/* No Data Dialog */}
            <NoDataDialog
                open={showNoDataDialog}
                onOpenChange={setShowNoDataDialog}
                dataAgeMinutes={data?.dataAgeMinutes ?? undefined}
            />
        </div>
    );
}
