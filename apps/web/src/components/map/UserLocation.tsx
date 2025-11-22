import L from "leaflet";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { BsPinFill } from "react-icons/bs";
import { FaLocationArrow } from "react-icons/fa6";
import { MdLocationOff } from "react-icons/md";
import { Marker, useMap } from "react-leaflet";
import { Z_LAYERS } from "@/util/constants";
import { createUserLocationIcon } from "@/util/icon";

// Custom hook for user geolocation
function useGeolocation() {
    const [location, setLocation] = useState<{
        lat: number;
        lng: number;
    } | null>(null);
    const [isWatching, setIsWatching] = useState(false);
    const [hasPermission, setHasPermission] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [hasError, setHasError] = useState(false);
    const watchIdRef = useRef<number | null>(null);
    const hasRequestedRef = useRef(false);
    const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const startWatching = useCallback(() => {
        if (!navigator.geolocation || isWatching) return;

        setIsWatching(true);
        const watchId = navigator.geolocation.watchPosition(
            (position) => {
                setLocation({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                });
            },
            (error) => {
                console.log("Watch position error:", error.message);
                // Don't set hasError for temporary errors, only for permission denied
                if (error.code === error.PERMISSION_DENIED) {
                    setHasError(true);
                    setIsWatching(false);
                } else if (
                    error.code === error.POSITION_UNAVAILABLE ||
                    error.code === error.TIMEOUT
                ) {
                    // Retry after a short delay for temporary errors
                    console.log("Temporary location error, retrying...");
                    retryTimeoutRef.current = setTimeout(() => {
                        if (watchIdRef.current !== null) {
                            navigator.geolocation.clearWatch(
                                watchIdRef.current,
                            );
                        }
                        setIsWatching(false);
                        // Retry watching
                        setTimeout(() => startWatching(), 2000);
                    }, 3000);
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 5000,
            },
        );

        watchIdRef.current = watchId;
    }, [isWatching]);

    const getCurrentPosition = useCallback(
        (onSuccess?: (location: { lat: number; lng: number }) => void) => {
            if (!navigator.geolocation) {
                console.log("Geolocation is not supported by this browser.");
                setHasError(true);
                return;
            }

            setIsLoading(true);
            setHasError(false);

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const newLocation = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                    };
                    setLocation(newLocation);
                    setHasPermission(true);
                    setIsLoading(false);
                    setHasError(false);

                    // Start continuous tracking once permission is granted
                    if (!isWatching) {
                        startWatching();
                    }

                    if (onSuccess) {
                        onSuccess(newLocation);
                    }
                },
                (error) => {
                    setIsLoading(false);
                    setHasError(true);
                    console.log("Geolocation error:", error.message);
                },
                {
                    enableHighAccuracy: true,
                    timeout: 5000,
                    maximumAge: 5000, // 5 seconds - for real-time tracking
                },
            );
        },
        [isWatching, startWatching],
    );

    const stopWatching = useCallback(() => {
        if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
            setIsWatching(false);
        }
        // Clear any pending retry timeouts
        if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current);
            retryTimeoutRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (!hasRequestedRef.current) {
            hasRequestedRef.current = true;
            getCurrentPosition();
        }

        return () => {
            stopWatching();
        };
    }, [getCurrentPosition, stopWatching]);

    return {
        location,
        isWatching,
        hasPermission,
        isLoading,
        hasError,
        getCurrentPosition,
        startWatching,
        stopWatching,
    };
}

// Component to center map on user location
function LocationButton({
    userLocation,
    hasPermission,
    isLoading,
    hasError,
    onLocationRequest,
}: {
    userLocation: { lat: number; lng: number } | null;
    hasPermission: boolean;
    isLoading: boolean;
    hasError: boolean;
    onLocationRequest: (
        onSuccess?: (location: { lat: number; lng: number }) => void,
    ) => void;
}) {
    const t = useTranslations("UserLocation");
    const map = useMap();
    const containerRef = useRef<HTMLDivElement>(null);
    const [isFollowing, setIsFollowing] = useState(false);
    const followingRef = useRef(false);
    const hasInitializedFollowingRef = useRef(false);

    const centerOnUser = () => {
        if (userLocation) {
            map.setView([userLocation.lat, userLocation.lng], 15, {
                animate: true,
                duration: 1.2,
            });
            // Toggle following mode
            setIsFollowing(!isFollowing);
            followingRef.current = !isFollowing;
        } else {
            // Request location and center map when location is obtained
            onLocationRequest((location) => {
                map.setView([location.lat, location.lng], 15, {
                    animate: true,
                    duration: 1.2,
                });
                setIsFollowing(true);
                followingRef.current = true;
            });
        }
    };

    // Follow user location when following is enabled
    useEffect(() => {
        if (isFollowing && userLocation) {
            map.setView([userLocation.lat, userLocation.lng], map.getZoom(), {
                animate: true,
                duration: 0.5,
            });
        }
    }, [userLocation, isFollowing, map]);

    // Auto-enable following when location is first obtained (Google Maps-like behavior)
    useEffect(() => {
        if (
            hasPermission &&
            userLocation &&
            !hasInitializedFollowingRef.current
        ) {
            hasInitializedFollowingRef.current = true;
            setIsFollowing(true);
            followingRef.current = true;
            // Center the map on the user's location initially
            map.setView([userLocation.lat, userLocation.lng], 15, {
                animate: true,
                duration: 1.2,
            });
        }
    }, [hasPermission, userLocation, map]);

    // Memoize the handleMapMove function to prevent unnecessary listener re-registrations
    const handleMapMove = useCallback(() => {
        if (followingRef.current) {
            setIsFollowing(false);
            followingRef.current = false;
        }
    }, []);

    // Stop following when user manually moves the map
    useEffect(() => {
        map.on("dragstart", handleMapMove);
        map.on("zoomstart", handleMapMove);

        return () => {
            map.off("dragstart", handleMapMove);
            map.off("zoomstart", handleMapMove);
        };
    }, [map, handleMapMove]);

    useEffect(() => {
        if (!containerRef.current) return;

        const container = containerRef.current;

        const handleClick = (e: MouseEvent) => {
            e.preventDefault();
        };

        container.addEventListener("click", handleClick);
        container.addEventListener("wheel", handleClick);

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        return () => {
            container.removeEventListener("click", handleClick);
            container.removeEventListener("wheel", handleClick);
        };
    }, []);

    const getIconClassName = () => {
        if (isLoading) return "scale-150 text-gray-500 dark:text-gray-400";
        if (hasError) return "scale-150 text-red-500 dark:text-red-400";
        if (isFollowing) return "scale-150 text-green-600 dark:text-green-400";
        if (hasPermission) return "scale-150 text-blue-600 dark:text-blue-400";
        return "scale-150 text-gray-700 dark:text-gray-300";
    };

    const getIcon = () => {
        if (hasError) return <MdLocationOff className={getIconClassName()} />;
        return <FaLocationArrow className={getIconClassName()} />;
    };

    return (
        <div
            className="absolute top-34 left-3"
            style={{ zIndex: Z_LAYERS.MAP_CONTROLS }}
            ref={containerRef}
        >
            <div className="relative">
                <motion.button
                    onClick={centerOnUser}
                    disabled={isLoading}
                    className="w-12 h-12 bg-white/95 dark:bg-card/95 backdrop-blur-md rounded-lg cursor-pointer shadow-lg border border-gray-200/50 dark:border-white/50 flex items-center justify-center group hover:bg-white dark:hover:bg-black"
                    aria-label={
                        hasError
                            ? t("location_error")
                            : hasPermission
                              ? t("center_map")
                              : t("get_location")
                    }
                    whileHover={
                        !isLoading
                            ? {
                                  scale: 1.05,
                                  boxShadow: "0 10px 25px rgba(0, 0, 0, 0.15)",
                              }
                            : {}
                    }
                    whileTap={
                        !isLoading
                            ? {
                                  scale: 0.95,
                                  transition: { duration: 0.1 },
                              }
                            : {}
                    }
                    transition={{
                        type: "spring",
                        stiffness: 400,
                        damping: 17,
                    }}
                >
                    {getIcon()}
                </motion.button>

                {/* Pin indicator when following */}
                {isFollowing && (
                    <motion.div
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={{
                            type: "spring",
                            stiffness: 400,
                            damping: 17,
                        }}
                        className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 dark:bg-green-600 rounded-full flex items-center justify-center shadow-md"
                    >
                        <BsPinFill className="text-white text-xs" />
                    </motion.div>
                )}
            </div>
        </div>
    );
}

export function UserLocation() {
    const {
        location: userLocation,
        getCurrentPosition,
        hasPermission,
        isLoading,
        hasError,
    } = useGeolocation();

    return (
        <>
            {/* User location marker - shown once permission is granted */}
            {userLocation && (
                <Marker
                    position={[userLocation.lat, userLocation.lng]}
                    icon={createUserLocationIcon()}
                    zIndexOffset={Z_LAYERS.USER_LOCATION_MARKER}
                />
            )}

            {/* Location control button */}
            <LocationButton
                userLocation={userLocation}
                hasPermission={hasPermission}
                isLoading={isLoading}
                hasError={hasError}
                onLocationRequest={getCurrentPosition}
            />
        </>
    );
}
