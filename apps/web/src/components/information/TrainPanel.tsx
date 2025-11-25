import type { InfoService } from "@megisholavonat/api-client";
import { formatDistanceToNow } from "date-fns";
import { enGB, hu } from "date-fns/locale";
import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import {
    FaArrowRight,
    FaCircleInfo,
    FaTriangleExclamation,
    FaXmark,
} from "react-icons/fa6";
import TooltipPopover from "@/components/ui/TooltipPopover";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
    ORANGE_THRESHOLD,
    RED_THRESHOLD,
    YELLOW_THRESHOLD,
} from "@/util/constants";
import { mnr2007 } from "@/util/fonts";
import { formatSecondsAsTime } from "@/util/time";
import {
    dataAppearsFalsified,
    isActive,
    isFarFromRoute,
    isStale,
} from "@/util/vehicle";
import MAVRouteIcon from "../ui/MavRouteIcon";
import { useQuery } from "@tanstack/react-query";
import { getTrainDetailsOptions } from "@megisholavonat/api-client/react-query";

interface TrainPanelProps {
    vehicleId: string;
    onClose?: () => void;
    showCloseButton?: boolean;
}

function formatTime(epochSeconds: number, currentLocale: string): string {
    const date = new Date(epochSeconds * 1000);
    return formatDistanceToNow(date, {
        addSuffix: true,
        locale: currentLocale === "hu" ? hu : enGB,
    });
}

function formatUICCode(vehicleId: string): string {
    // Remove the prefix and get the numeric part
    const numericPart = vehicleId.split(":")[1] || vehicleId;

    // Ensure we have exactly 12 digits, pad with zeros if necessary
    const paddedNumber = numericPart.padStart(12, "0");

    // Format as: XX XX XXXX XXX-X
    const formatted = `${paddedNumber.slice(0, 2)} ${paddedNumber.slice(
        2,
        4,
    )} ${paddedNumber.slice(4, 8)} ${paddedNumber.slice(
        8,
        11,
    )}-${paddedNumber.slice(11, 12)}`;

    return formatted;
}

export function getDelayColor(delay: number, darkBg: boolean = false): string {
    if (delay >= RED_THRESHOLD) {
        return darkBg ? "text-red-400" : "text-red-600";
    } else if (delay >= ORANGE_THRESHOLD) {
        return darkBg ? "text-orange-300" : "text-orange-500";
    } else if (delay >= YELLOW_THRESHOLD) {
        return darkBg ? "text-yellow-200" : "text-yellow-400";
    }

    return darkBg ? "text-green-400" : "text-green-600";
}

function TimeDisplay({
    scheduled,
    realtime,
}: {
    scheduled: number | null;
    realtime: number | null;
}) {
    const isMobile = useIsMobile();
    if (!scheduled || !realtime) {
        return (
            <span className="text-gray-400 dark:text-muted-foreground">—</span>
        );
    }

    const delayMinutes = Math.round((realtime - scheduled) / 60);

    const delayColor = getDelayColor(delayMinutes);

    return (
        <div className={`flex flex-col ${isMobile ? "gap-0" : "gap-1"}`}>
            {scheduled && (
                <div
                    className={`text-gray-500 dark:text-muted-foreground ${isMobile ? "text-xs" : "text-sm"}`}
                >
                    {formatSecondsAsTime(scheduled)}
                </div>
            )}
            {realtime && (
                <div
                    className={`font-semibold ${
                        isMobile ? "text-xs" : "text-sm"
                    } ${delayColor}`}
                >
                    {formatSecondsAsTime(realtime)}
                </div>
            )}
            {!realtime && scheduled && (
                <div
                    className={`text-gray-600 dark:text-muted-foreground ${isMobile ? "text-xs" : "text-sm"}`}
                >
                    {formatSecondsAsTime(scheduled)}
                </div>
            )}
        </div>
    );
}

function ServiceBadge({
    service,
    className,
}: {
    service: InfoService;
    className: string;
}) {
    return (
        <TooltipPopover content={service.name}>
            <span className={className}>
                {String.fromCharCode(Number(service.fontCode))}
            </span>
        </TooltipPopover>
    );
}

function AlertBadge({
    alertCount,
    isExpanded,
    onClick,
}: {
    alertCount: number;
    isExpanded: boolean;
    onClick: () => void;
}) {
    const t = useTranslations("TrainPanel");

    return (
        <TooltipPopover content={t("alerts", { count: alertCount })}>
            <button
                type="button"
                onClick={onClick}
                className={`px-2 py-1 text-sm cursor-pointer rounded border transition-all duration-200 flex items-center gap-1 ${
                    isExpanded
                        ? "bg-red-600 dark:bg-red-700 text-white border-red-700 dark:border-red-800 shadow-md"
                        : "bg-red-500 dark:bg-red-600 text-white border-red-600 dark:border-red-700 hover:bg-red-600 dark:hover:bg-red-700 hover:shadow-md"
                }`}
            >
                <FaTriangleExclamation className="w-3 h-3" />
                <span className="font-semibold">{alertCount}</span>
            </button>
        </TooltipPopover>
    );
}

export function TrainPanel({
    vehicleId,
    onClose,
    showCloseButton = false,
}: TrainPanelProps) {
    const { data: vehiclePosition } = useQuery(
        getTrainDetailsOptions({ path: { vehicle_id: vehicleId } }),
    );

    const [alertsOpen, setAlertsOpen] = useState(false);
    const t = useTranslations("TrainPanel");
    const isMobile = useIsMobile();
    const locale = useLocale();

    if (!vehiclePosition) {
        return null;
    }

    const trainIsStale = isStale(vehiclePosition);

    const delayColor = getDelayColor(vehiclePosition.delay, true);

    // Calculate total number of stops
    const totalStops = vehiclePosition.trip.stoptimes.length;

    // Check if data appears to be falsified using utility function
    const trainIsActive = isActive(vehiclePosition);
    const dataFalsified =
        trainIsActive && dataAppearsFalsified(vehiclePosition, trainIsStale);

    // Check if train is far from its designated route
    const farFromRoute = isFarFromRoute(vehiclePosition);

    // Separate services that apply to all stops vs specific stops
    const allStopsServices = vehiclePosition.trip.infoServices.filter(
        (service) =>
            service.fromStopIndex === 0 &&
            service.tillStopIndex === totalStops - 1,
    );

    const specificStopServices = vehiclePosition.trip.infoServices.filter(
        (service) =>
            !(
                service.fromStopIndex === 0 &&
                service.tillStopIndex === totalStops - 1
            ),
    );

    // Helper function to get services for a specific stop
    const getServicesForStop = (stopIndex: number) => {
        return specificStopServices.filter(
            (service) =>
                stopIndex >= service.fromStopIndex &&
                stopIndex <= service.tillStopIndex,
        );
    };

    const hasAlerts =
        vehiclePosition.trip.alerts && vehiclePosition.trip.alerts.length > 0;

    return (
        <div className={`flex flex-col ${isMobile ? "h-auto" : "h-full"}`}>
            {/* Header */}
            <div className="bg-linear-to-r from-blue-600 to-blue-700 dark:from-blue-800 dark:to-blue-900 text-white p-4 relative shadow-lg shrink-0">
                <div
                    className={`flex justify-between items-center ${
                        isMobile ? "mt-3" : ""
                    }`}
                >
                    <div
                        className="bg-white dark:bg-gray-100 rounded-lg w-12 h-8 align-middle text-lg items-center justify-center flex"
                        style={{
                            color: `#${vehiclePosition.trip.route.textColor}`,
                        }}
                    >
                        <div className="pt-2 pb-1">
                            <MAVRouteIcon
                                routeShortName={
                                    vehiclePosition.trip.route.shortName
                                }
                            />
                        </div>
                    </div>

                    <h2 className="text-xl font-bold text-center">
                        {vehiclePosition.trip.tripShortName}
                    </h2>
                    {showCloseButton && onClose && (
                        <button
                            onClick={onClose}
                            type="button"
                            className="text-white hover:text-gray-200 dark:hover:text-gray-300 text-xl cursor-pointer transition-colors duration-200 hover:bg-white/20 dark:hover:bg-white/30 rounded-full p-1"
                        >
                            <FaXmark className="w-4 h-4" />
                        </button>
                    )}
                </div>
                <div className="text-sm mt-2 flex gap-4 flex-wrap">
                    <span className="flex items-center gap-1">
                        <span className="opacity-80">{t("uic_code")}:</span>
                        <span className="font-semibold text-white font-mono">
                            {formatUICCode(vehiclePosition.vehicleId)}
                        </span>
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="opacity-80">{t("speed")}:</span>
                        <span className="font-semibold text-white">
                            {Math.round(vehiclePosition.speed * 3.6)} km/h
                        </span>
                    </span>
                    {isActive(vehiclePosition) && !trainIsStale && (
                        <span className="flex items-center gap-1">
                            <span className="opacity-80">{t("delay")}:</span>
                            <span className={`font-semibold ${delayColor}`}>
                                {t("delay_minutes", {
                                    delay: vehiclePosition.delay,
                                })}
                            </span>
                            <TooltipPopover content={t("delay_note")}>
                                <FaCircleInfo className="w-3 h-3 text-white/60 dark:text-white/70 hover:text-white/80 dark:hover:text-white/90 cursor-help transition-colors" />
                            </TooltipPopover>
                        </span>
                    )}
                    <span className="flex items-center gap-1">
                        <span className="opacity-80">{t("last_updated")}:</span>
                        <span className="font-semibold text-white">
                            {trainIsStale && "⚠️ "}
                            {formatTime(vehiclePosition.lastUpdated, locale)}
                        </span>
                    </span>
                </div>
                {/* Start and End Stations */}
                {vehiclePosition.trip.stoptimes.length > 0 && (
                    <div className="text-xs mt-2 opacity-80">
                        <span className="font-semibold">
                            {vehiclePosition.trip.stoptimes[0].stop.name}
                        </span>
                        <FaArrowRight className="mx-2 inline w-3 h-3" />
                        <span className="font-semibold">
                            {
                                vehiclePosition.trip.stoptimes[
                                    vehiclePosition.trip.stoptimes.length - 1
                                ].stop.name
                            }
                        </span>
                    </div>
                )}
            </div>

            {/* Services that apply to all stops + Alerts */}
            {(allStopsServices.length > 0 || hasAlerts) && (
                <div className="bg-blue-50 dark:bg-card/95 px-4 py-3 border-b dark:border-gray-700 shrink-0">
                    <div className="flex flex-wrap gap-1">
                        {allStopsServices.map((infoService, index) => (
                            <ServiceBadge
                                // biome-ignore lint/suspicious/noArrayIndexKey: We do not have a stable key
                                key={index}
                                service={infoService}
                                className={`text-black dark:text-card-foreground px-2 py-1 text-lg select-none bg-white dark:bg-card rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-accent ${mnr2007.className}`}
                            />
                        ))}
                        {hasAlerts && (
                            <AlertBadge
                                alertCount={vehiclePosition.trip.alerts.length}
                                isExpanded={alertsOpen}
                                onClick={() => setAlertsOpen(!alertsOpen)}
                            />
                        )}
                    </div>

                    {/* Expanded Alerts */}
                    <AnimatePresence>
                        {alertsOpen && hasAlerts && (
                            <motion.div
                                className="overflow-hidden"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{
                                    duration: 0.3,
                                    ease: [0.4, 0.0, 0.2, 1],
                                    opacity: { duration: 0.2 },
                                }}
                            >
                                <div className="mt-3 pt-3 border-t border-blue-200 dark:border-gray-700">
                                    <motion.div
                                        className="space-y-3"
                                        initial={{ y: -10 }}
                                        animate={{ y: 0 }}
                                        transition={{
                                            duration: 0.3,
                                            delay: 0.1,
                                        }}
                                    >
                                        {vehiclePosition.trip.alerts.map(
                                            (alert, index) => (
                                                <motion.div
                                                    // biome-ignore lint/suspicious/noArrayIndexKey: We do not have a stable key
                                                    key={index}
                                                    className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800/50 rounded-lg p-3"
                                                    initial={{
                                                        opacity: 0,
                                                        x: -20,
                                                    }}
                                                    animate={{
                                                        opacity: 1,
                                                        x: 0,
                                                    }}
                                                    transition={{
                                                        duration: 0.3,
                                                        delay:
                                                            index * 0.1 + 0.15,
                                                        ease: "easeOut",
                                                    }}
                                                >
                                                    <div className="flex items-start gap-2">
                                                        <FaTriangleExclamation className="h-4 w-4 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
                                                        <div className="flex-1">
                                                            <p className="text-sm text-red-800 dark:text-red-200 mb-1">
                                                                {
                                                                    alert.alertDescriptionText
                                                                }
                                                            </p>
                                                            {alert.alertUrl && (
                                                                <a
                                                                    href={
                                                                        alert.alertUrl
                                                                    }
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 underline text-xs transition-colors duration-150"
                                                                >
                                                                    További
                                                                    információ
                                                                </a>
                                                            )}
                                                            <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                                                                {new Date(
                                                                    alert.effectiveStartDate *
                                                                        1000,
                                                                ).toLocaleString(
                                                                    "hu-HU",
                                                                )}{" "}
                                                                -{" "}
                                                                {new Date(
                                                                    alert.effectiveEndDate *
                                                                        1000,
                                                                ).toLocaleString(
                                                                    "hu-HU",
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            ),
                                        )}
                                    </motion.div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            )}

            {/* Train Far From Route Warning */}
            {farFromRoute && (
                <div className="bg-orange-50 dark:bg-card/95 border-l-4 border-l-orange-400 dark:border-l-orange-500 border-b border-b-gray-200 dark:border-b-border shrink-0">
                    <div className="px-4 py-3">
                        <div className="flex items-start">
                            <FaTriangleExclamation className="h-5 w-5 text-orange-400 dark:text-orange-300 shrink-0 mt-0.5" />
                            <div className="ml-3 flex-1">
                                <h3 className="text-sm font-medium text-orange-800 dark:text-orange-200">
                                    {t("route_data_warning")}
                                </h3>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* MAV Data Warning */}
            {dataFalsified && (
                <div className="bg-orange-50 dark:bg-card/95 border-l-4 border-l-orange-400 dark:border-l-orange-500 border-b border-b-gray-200 dark:border-b-border shrink-0">
                    <div className="px-4 py-3">
                        <div className="flex items-start">
                            <FaTriangleExclamation className="h-5 w-5 text-orange-400 dark:text-orange-300 shrink-0 mt-0.5" />
                            <div className="ml-3 flex-1">
                                <h3 className="text-sm font-medium text-orange-800 dark:text-orange-200">
                                    {t("data_discrepancy_warning")}{" "}
                                    <TooltipPopover
                                        content={t("algorithm_note")}
                                    >
                                        <FaCircleInfo className="w-3 h-3 cursor-help transition-colors inline" />
                                    </TooltipPopover>
                                </h3>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Table */}
            <div
                className={`${isMobile ? "flex-none" : "flex-1 overflow-auto"} min-h-0 dark:bg-card/95`}
            >
                <table className="w-full">
                    <thead
                        className={`bg-gray-100 dark:bg-card/95 border-y-2 border-gray-200 dark:border-gray-700 ${
                            !isMobile ? "sticky top-0 z-30" : ""
                        }`}
                    >
                        <tr>
                            <th
                                className="w-8 border-r border-gray-200 dark:border-gray-700"
                                style={{ width: "32px", minWidth: "32px" }}
                            ></th>
                            <th className="text-left p-3 font-semibold text-gray-800 dark:text-card-foreground border-r border-gray-200 dark:border-gray-700">
                                {t("timetable.station")}
                            </th>
                            <th
                                className={`text-left ${
                                    isMobile ? "p-2" : "p-3"
                                } font-semibold text-gray-800 dark:text-card-foreground border-r border-gray-200 dark:border-gray-700 whitespace-nowrap`}
                            >
                                {t("timetable.arrival")}
                            </th>
                            <th
                                className={`text-left ${
                                    isMobile ? "p-2" : "p-3"
                                } font-semibold text-gray-800 dark:text-card-foreground whitespace-nowrap`}
                            >
                                {t("timetable.departure")}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {vehiclePosition.trip.stoptimes.map(
                            (stoptime, index) => {
                                const stopServices = getServicesForStop(index);

                                // Find the processed stop data for this stop
                                const processedStop =
                                    vehiclePosition.processedStops?.find(
                                        (ps) => ps.id === stoptime.stop.name,
                                    );

                                // Determine if this stop has been passed
                                const hasPassed = processedStop
                                    ? vehiclePosition.trainPosition >
                                      processedStop.distanceAlongRoute
                                    : false;

                                // Calculate if train is between this stop and the next
                                const nextStop =
                                    vehiclePosition.processedStops?.[index + 1];
                                const isTrainBetweenStops =
                                    processedStop &&
                                    nextStop &&
                                    vehiclePosition.trainPosition >=
                                        processedStop.distanceAlongRoute &&
                                    vehiclePosition.trainPosition <=
                                        nextStop.distanceAlongRoute;

                                // Calculate train position percentage between this stop and next
                                let trainPositionPercent = 0;
                                if (
                                    isTrainBetweenStops &&
                                    processedStop &&
                                    nextStop
                                ) {
                                    const segmentDistance =
                                        nextStop.distanceAlongRoute -
                                        processedStop.distanceAlongRoute;
                                    const trainDistanceInSegment =
                                        vehiclePosition.trainPosition -
                                        processedStop.distanceAlongRoute;
                                    trainPositionPercent = Math.min(
                                        100,
                                        Math.max(
                                            0,
                                            (trainDistanceInSegment /
                                                segmentDistance) *
                                                100,
                                        ),
                                    );
                                }

                                // Check if this is the last stop
                                const isLastStop =
                                    index ===
                                    vehiclePosition.trip.stoptimes.length - 1;

                                return (
                                    <tr
                                        key={stoptime.stop.name}
                                        className="border-b border-gray-100 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-accent/50 transition-colors duration-150"
                                    >
                                        {/* Progress Line Column */}
                                        <td
                                            className="w-8 border-r border-gray-100 dark:border-gray-700 bg-white dark:bg-card/95 p-0 relative"
                                            style={{
                                                width: "32px",
                                                minWidth: "32px",
                                            }}
                                        >
                                            <div className="flex flex-col items-center h-full min-h-[60px] relative">
                                                {/* Vertical line above stop */}
                                                {index > 0 && (
                                                    <div
                                                        className={`absolute left-1/2 transform -translate-x-1/2 w-0.5 ${
                                                            hasPassed
                                                                ? "bg-blue-500 dark:bg-blue-400"
                                                                : "bg-gray-300 dark:bg-gray-600"
                                                        }`}
                                                        style={{
                                                            top: "0",
                                                            height: "50%",
                                                        }}
                                                    />
                                                )}

                                                {/* Stop circle */}
                                                <div
                                                    className={`relative z-10 w-3 h-3 rounded-full border-2 mt-6 ${
                                                        hasPassed
                                                            ? "bg-blue-500 dark:bg-blue-400 border-blue-600 dark:border-blue-500"
                                                            : "bg-white dark:bg-card border-gray-400 dark:border-muted-foreground"
                                                    }`}
                                                />

                                                {/* Train indicator between stops */}
                                                {isTrainBetweenStops && (
                                                    <div
                                                        className="absolute z-20 left-1/2 transform -translate-x-1/2"
                                                        style={{
                                                            top: `calc(50% + ${trainPositionPercent}% * 0.4)`,
                                                        }}
                                                    >
                                                        <div className="w-4 h-4 bg-green-500 dark:bg-green-400 rounded-full border-2 border-white dark:border-card shadow-lg flex items-center justify-center">
                                                            <div className="w-1.5 h-1.5 bg-white dark:bg-card rounded-full"></div>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Vertical line below stop (only if not last stop) */}
                                                {!isLastStop && (
                                                    <div
                                                        className={`absolute left-1/2 transform -translate-x-1/2 w-0.5 ${
                                                            hasPassed
                                                                ? "bg-blue-500 dark:bg-blue-400"
                                                                : "bg-gray-300 dark:bg-gray-600"
                                                        }`}
                                                        style={{
                                                            top: "50%",
                                                            height: "50%",
                                                        }}
                                                    />
                                                )}
                                            </div>
                                        </td>

                                        <td className="p-3 font-semibold text-gray-900 dark:text-card-foreground border-r border-gray-100 dark:border-gray-700 bg-white dark:bg-card/95">
                                            <div className="flex items-center justify-between gap-1">
                                                <div className="flex flex-col min-w-0 flex-1">
                                                    <div className="flex items-center gap-1 min-w-0">
                                                        {stoptime.stop
                                                            .county ? (
                                                            <TooltipPopover
                                                                content={t(
                                                                    "county_hover",
                                                                    {
                                                                        county: stoptime
                                                                            .stop
                                                                            .county,
                                                                    },
                                                                )}
                                                            >
                                                                <span
                                                                    className={`cursor-help wrap-break-word ${
                                                                        hasPassed
                                                                            ? "text-gray-500 dark:text-muted-foreground"
                                                                            : ""
                                                                    }`}
                                                                >
                                                                    {
                                                                        stoptime
                                                                            .stop
                                                                            .name
                                                                    }
                                                                </span>
                                                            </TooltipPopover>
                                                        ) : (
                                                            <span
                                                                className={`wrap-break-word ${
                                                                    hasPassed
                                                                        ? "text-gray-500 dark:text-muted-foreground"
                                                                        : ""
                                                                }`}
                                                            >
                                                                {
                                                                    stoptime
                                                                        .stop
                                                                        .name
                                                                }
                                                            </span>
                                                        )}
                                                    </div>
                                                    {stopServices.length >
                                                        0 && (
                                                        <div className="flex flex-wrap gap-1 mt-1">
                                                            {stopServices.map(
                                                                (
                                                                    service,
                                                                    serviceIndex,
                                                                ) => (
                                                                    <ServiceBadge
                                                                        key={
                                                                            // biome-ignore lint/suspicious/noArrayIndexKey: We do not have a stable key
                                                                            serviceIndex
                                                                        }
                                                                        service={
                                                                            service
                                                                        }
                                                                        className={`text-black dark:text-card-foreground px-1 text-lg cursor-pointer bg-yellow-100 dark:bg-yellow-900/30 rounded border border-yellow-200 dark:border-yellow-200/50 ${mnr2007.className}`}
                                                                    />
                                                                ),
                                                            )}
                                                        </div>
                                                    )}
                                                </div>

                                                {stoptime.stop.platformCode && (
                                                    <TooltipPopover
                                                        content={t(
                                                            "timetable.platform",
                                                        )}
                                                    >
                                                        <div className="flex flex-row">
                                                            <span className="inline-flex items-center justify-center min-w-[24px] h-5 px-1.5 bg-blue-600 dark:bg-blue-700 text-white text-xs font-semibold rounded border border-blue-700 dark:border-blue-800 shadow-sm">
                                                                {
                                                                    stoptime
                                                                        .stop
                                                                        .platformCode
                                                                }
                                                            </span>
                                                        </div>
                                                    </TooltipPopover>
                                                )}
                                            </div>
                                        </td>
                                        <td
                                            className={`${
                                                isMobile ? "p-2" : "p-3"
                                            } border-r border-gray-100 dark:border-gray-700 bg-white dark:bg-card/95 whitespace-nowrap`}
                                        >
                                            <TimeDisplay
                                                scheduled={
                                                    stoptime.scheduledArrival
                                                }
                                                realtime={
                                                    stoptime.realtimeArrival
                                                }
                                            />
                                        </td>
                                        <td
                                            className={`${isMobile ? "p-2" : "p-3"} bg-white dark:bg-card/95 whitespace-nowrap`}
                                        >
                                            <TimeDisplay
                                                scheduled={
                                                    stoptime.scheduledDeparture
                                                }
                                                realtime={
                                                    stoptime.realtimeDeparture
                                                }
                                            />
                                        </td>
                                    </tr>
                                );
                            },
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
