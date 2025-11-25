"use client";

import type {
    ApiResponse,
    StopTimeWithCounty,
} from "@megisholavonat/api-client";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
    LuChevronDown,
    LuClock,
    LuGauge,
    LuMapPin,
    LuSearch,
} from "react-icons/lu";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Z_LAYERS } from "@/util/constants";
import { isStale } from "@/util/vehicle";
import MAVRouteIcon from "../ui/MavRouteIcon";
import { getDelayColor } from "./TrainPanel";

interface SearchComponentProps {
    data: ApiResponse | undefined;
    onResultClick?: (vehicleId: string) => void;
}

function formatSpeed(speed: number): string {
    return `${Math.round(speed * 3.6)} km/h`;
}

type SortOption = "number" | "delay" | "speed";

function getStationRoute(stoptimes: StopTimeWithCounty[]) {
    if (stoptimes.length === 0) return null;

    const firstStop = stoptimes[0]?.stop?.name;
    const lastStop = stoptimes[stoptimes.length - 1]?.stop?.name;

    if (!firstStop || !lastStop) return null;

    // Shorten station names if they're too long
    const shortenName = (name: string) => {
        if (name.length > 15) {
            return `${name.substring(0, 12)}...`;
        }
        return name;
    };

    return `${shortenName(firstStop)} → ${shortenName(lastStop)}`;
}

export default function SearchComponent({
    data,
    onResultClick,
}: SearchComponentProps) {
    const t = useTranslations("SearchComponent");

    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [sortBy, setSortBy] = useState<SortOption>("number");
    const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
    const searchRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Close search when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            const target = event.target as Element;

            // Check if the click is inside the search component
            const isInsideSearch = searchRef.current?.contains(target);

            // Check if the click is on a Select portal element (which are rendered outside the search component)
            const isSelectPortal =
                target.closest("[data-radix-select-content]") ||
                target.closest("[data-radix-select-viewport]") ||
                target.closest("[data-radix-popper-content-wrapper]");

            // Only close if the click is truly outside both the search component and any Select portals
            if (!isInsideSearch && !isSelectPortal) {
                setIsOpen(false);
            }
        }

        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
            return () =>
                document.removeEventListener("mousedown", handleClickOutside);
        }
    }, [isOpen]);

    // Handle escape key
    useEffect(() => {
        function handleEscape(event: KeyboardEvent) {
            if (event.key === "Escape" && isOpen) {
                event.preventDefault();
                event.stopPropagation();
                setIsOpen(false);
                setSearchQuery("");
            }
        }

        if (isOpen) {
            document.addEventListener("keydown", handleEscape);
            return () => document.removeEventListener("keydown", handleEscape);
        }
    }, [isOpen]);

    const handleSearchClick = () => {
        setIsOpen(!isOpen);
        if (!isOpen) {
            // Focus input when opening
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    };

    const handleResultClick = (result: string) => {
        setIsOpen(false);
        setSearchQuery("");
        onResultClick?.(result);
    };

    // Filter and sort results based on search query and sort option
    const filteredAndSortedResults = (() => {
        const filtered =
            data?.locations?.filter((result) => {
                if (!searchQuery.trim()) return true;

                const query = searchQuery.toLowerCase();
                const tripName = result.trip.tripShortName.toLowerCase();
                const routeName = result.trip.route.longName.toLowerCase();

                let vehicleIdMatches = false;
                try {
                    if (
                        result.vehicleId &&
                        typeof result.vehicleId === "string" &&
                        result.vehicleId.length > 2
                    ) {
                        const vehicleId = result.vehicleId.slice(2);
                        const sanitizedQuery = query
                            .replaceAll(" ", "")
                            .replaceAll("-", "");
                        vehicleIdMatches = vehicleId.includes(sanitizedQuery);
                    }
                } catch (error) {
                    console.warn(
                        "Error processing vehicleId in search:",
                        error,
                    );
                    vehicleIdMatches = false;
                }

                const fromStop =
                    result.trip.stoptimes[0]?.stop?.name.toLowerCase();
                const toStop =
                    result.trip.stoptimes[
                        result.trip.stoptimes.length - 1
                    ]?.stop?.name.toLowerCase();

                return (
                    tripName.includes(query) ||
                    routeName.includes(query) ||
                    vehicleIdMatches ||
                    fromStop?.includes(query) ||
                    toStop?.includes(query)
                );
            }) || [];

        // Separate stale and non-stale trains
        const nonStaleTrains = filtered.filter((train) => !isStale(train));
        const staleTrains = filtered.filter((train) => isStale(train));

        // Sort non-stale trains
        const sortedNonStale = nonStaleTrains.sort((a, b) => {
            let comparison = 0;

            switch (sortBy) {
                case "number":
                    comparison = a.trip.tripShortName.localeCompare(
                        b.trip.tripShortName,
                        undefined,
                        { numeric: true },
                    );
                    break;
                case "delay":
                    comparison = a.delay - b.delay;
                    break;
                case "speed":
                    comparison = a.speed - b.speed;
                    break;
                default:
                    return 0;
            }

            return sortDirection === "asc" ? comparison : -comparison;
        });

        // Sort stale trains (same logic but separate)
        const sortedStale = staleTrains.sort((a, b) => {
            let comparison = 0;

            switch (sortBy) {
                case "number":
                    comparison = a.trip.tripShortName.localeCompare(
                        b.trip.tripShortName,
                        undefined,
                        { numeric: true },
                    );
                    break;
                case "delay":
                    comparison = a.delay - b.delay;
                    break;
                case "speed":
                    comparison = a.speed - b.speed;
                    break;
                default:
                    return 0;
            }

            return sortDirection === "asc" ? comparison : -comparison;
        });

        // Return non-stale trains first, then stale trains
        return [...sortedNonStale, ...sortedStale];
    })();

    return (
        <div
            ref={searchRef}
            className="relative"
            style={{
                zIndex: Z_LAYERS.SEARCH_BUTTON,
                pointerEvents: isOpen ? "auto" : "none",
            }}
        >
            {/* Search Button */}
            <motion.button
                onClick={handleSearchClick}
                className="w-10 h-10 rounded-lg flex cursor-pointer items-center hover:shadow-md justify-center text-gray-600 dark:text-white hover:text-blue-600 dark:hover:text-white hover:bg-blue-50 dark:hover:bg-black/95 transition-colors"
                style={{ pointerEvents: "auto" }}
                aria-label={t("search_button")}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                transition={{
                    type: "spring",
                    stiffness: 400,
                    damping: 17,
                }}
            >
                <motion.div transition={{ duration: 0.2 }}>
                    <LuSearch className="w-5 h-5" />
                </motion.div>
            </motion.button>

            {/* Search Dropdown */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: -10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -10, scale: 0.95 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        className="
              sm:absolute sm:top-full sm:left-1/2 sm:transform sm:-translate-x-1/2 sm:mt-2 sm:w-96 sm:max-w-[calc(100vw-2rem)]
              fixed top-16 left-1/2 transform -translate-x-1/2 w-[calc(100vw-2rem)] max-w-sm
              bg-white/95 dark:bg-card/95 backdrop-blur-md rounded-2xl shadow-lg border border-gray-200/50 dark:border-border overflow-hidden
            "
                        style={{
                            zIndex: Z_LAYERS.SEARCH_DROPDOWN,
                            pointerEvents: "auto",
                        }}
                    >
                        {/* Search Input */}
                        <div className="p-4 border-b border-gray-200/50 dark:border-border">
                            <div className="space-y-3">
                                <div className="relative">
                                    <LuSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-muted-foreground" />
                                    <input
                                        ref={inputRef}
                                        type="text"
                                        placeholder={t("search_placeholder")}
                                        aria-label={t("search_placeholder")}
                                        value={searchQuery}
                                        onChange={(e) =>
                                            setSearchQuery(e.target.value)
                                        }
                                        className="w-full pl-10 pr-4 py-2 text-sm border border-gray-200 dark:border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent bg-white/80 dark:bg-card/80 text-gray-900 dark:text-card-foreground placeholder:text-gray-400 dark:placeholder:text-muted-foreground"
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <span
                                        id="sort-by-label"
                                        className="text-sm text-gray-700 dark:text-card-foreground"
                                    >
                                        {t("sort_by")}
                                    </span>
                                    <Select
                                        value={sortBy}
                                        onValueChange={(value: SortOption) =>
                                            setSortBy(value)
                                        }
                                    >
                                        <SelectTrigger
                                            className="w-full h-8"
                                            aria-labelledby="sort-by-label"
                                        >
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent
                                            style={{
                                                zIndex:
                                                    Z_LAYERS.SEARCH_DROPDOWN +
                                                    1,
                                            }}
                                        >
                                            <SelectItem value="number">
                                                {t("sort_by_options.number")}
                                            </SelectItem>
                                            <SelectItem value="delay">
                                                {t("sort_by_options.delay")}
                                            </SelectItem>
                                            <SelectItem value="speed">
                                                {t("sort_by_options.speed")}
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setSortDirection(
                                                sortDirection === "asc"
                                                    ? "desc"
                                                    : "asc",
                                            )
                                        }
                                        className="p-2 hover:bg-gray-100 dark:hover:bg-blue-900/50 rounded-md transition-colors"
                                        aria-label={`${t("sort_by")} ${
                                            sortDirection === "asc"
                                                ? t("sort_descending")
                                                : t("sort_ascending")
                                        }`}
                                    >
                                        <LuChevronDown
                                            className={`w-5 h-5 text-gray-600 dark:text-white transition-transform duration-200 stroke-2 ${
                                                sortDirection === "desc"
                                                    ? "rotate-180"
                                                    : ""
                                            }`}
                                        />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Search Results */}
                        <div className="max-h-64 overflow-y-auto">
                            {filteredAndSortedResults.length > 0 ? (
                                <div className="py-2">
                                    {filteredAndSortedResults.map((result) => {
                                        const delayColor = getDelayColor(
                                            result.delay,
                                        );
                                        const stationRoute = getStationRoute(
                                            result.trip.stoptimes,
                                        );
                                        const hasSpeed = result.speed > 0;
                                        const isTrainStale = isStale(result);

                                        return (
                                            <button
                                                key={result.vehicleId}
                                                type="button"
                                                onClick={() =>
                                                    handleResultClick(
                                                        result.vehicleId,
                                                    )
                                                }
                                                aria-label={`${t("select_train")} ${result.trip.tripShortName}, ${stationRoute}`}
                                                className={`w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-blue-900/30 transition-colors ${
                                                    isTrainStale
                                                        ? "opacity-60"
                                                        : ""
                                                }`}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <div
                                                        className={`shrink-0 mt-0.5 ${
                                                            isTrainStale
                                                                ? "opacity-50"
                                                                : ""
                                                        }`}
                                                        style={{
                                                            color: isTrainStale
                                                                ? "#9CA3AF"
                                                                : `#${result.trip.route.textColor}`,
                                                        }}
                                                    >
                                                        <MAVRouteIcon
                                                            routeShortName={
                                                                result.trip
                                                                    .route
                                                                    .shortName
                                                            }
                                                        />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        {/* First row: Train number */}

                                                        <span
                                                            className={`font-medium truncate ${
                                                                isTrainStale
                                                                    ? "text-gray-400 dark:text-gray-500"
                                                                    : "text-gray-900 dark:text-white"
                                                            }`}
                                                        >
                                                            {
                                                                result.trip
                                                                    .tripShortName
                                                            }
                                                        </span>

                                                        {/* Second row: Delay, Route, Speed */}
                                                        <div
                                                            className={`flex items-center gap-3 text-xs ${
                                                                isTrainStale
                                                                    ? "text-gray-400 dark:text-gray-500"
                                                                    : "text-gray-600 dark:text-gray-300"
                                                            }`}
                                                        >
                                                            {/* Delay */}
                                                            <div className="flex items-center gap-1">
                                                                <LuClock className="w-3 h-3 dark:text-white" />
                                                                <span
                                                                    className={`font-medium ${
                                                                        isTrainStale
                                                                            ? "text-gray-400 dark:text-gray-500"
                                                                            : delayColor
                                                                    }`}
                                                                >
                                                                    {
                                                                        result.delay
                                                                    }
                                                                    p
                                                                </span>
                                                            </div>

                                                            {/* Route */}
                                                            {stationRoute && (
                                                                <div className="flex items-center gap-1 flex-1 min-w-0">
                                                                    <LuMapPin className="w-3 h-3 shrink-0 dark:text-white" />
                                                                    <span
                                                                        className="truncate"
                                                                        title={
                                                                            stationRoute
                                                                        }
                                                                    >
                                                                        {
                                                                            stationRoute
                                                                        }
                                                                    </span>
                                                                </div>
                                                            )}

                                                            {/* Speed */}
                                                            {hasSpeed && (
                                                                <div className="flex items-center gap-1 shrink-0">
                                                                    <LuGauge className="w-3 h-3 dark:text-white" />
                                                                    <span>
                                                                        {formatSpeed(
                                                                            result.speed,
                                                                        )}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="py-8 px-4 text-center text-gray-500 dark:text-gray-400">
                                    <LuSearch className="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                                    <p className="text-sm">
                                        {searchQuery.trim()
                                            ? t("no_search_results")
                                            : t("no_trains_available")}
                                    </p>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
