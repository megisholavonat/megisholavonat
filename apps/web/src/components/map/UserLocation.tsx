"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { BsPinFill } from "react-icons/bs";
import { FaLocationArrow } from "react-icons/fa6";
import { MdLocationOff } from "react-icons/md";
import { Layer, type MapRef, Source } from "react-map-gl/maplibre";
import { useGeolocation } from "@/hooks/useGeolocation";
import { Z_LAYERS } from "@/util/constants";

const USER_LOCATION_SVG = `
<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="16" cy="16" r="14" fill="rgba(59, 130, 246, 0.15)" stroke="rgba(59, 130, 246, 0.4)" stroke-width="1">
    <animate attributeName="r" values="8;14;8" dur="2s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="0.8;0.2;0.8" dur="2s" repeatCount="indefinite"/>
  </circle>
  <circle cx="16" cy="16" r="10" fill="rgba(59, 130, 246, 0.25)" stroke="rgba(59, 130, 246, 0.6)" stroke-width="1"/>
  <circle cx="16" cy="16" r="6" fill="#2563EB" stroke="white" stroke-width="2"/>
  <circle cx="16" cy="16" r="3" fill="#60A5FA"/>
</svg>
`;

function LocationButton({
    mapRef,
    userLocation,
    hasPermission,
    isLoading,
    hasError,
    onLocationRequest,
}: {
    mapRef: React.RefObject<MapRef | null>;
    userLocation: { lat: number; lng: number } | null;
    hasPermission: boolean;
    isLoading: boolean;
    hasError: boolean;
    onLocationRequest: (
        onSuccess?: (location: { lat: number; lng: number }) => void,
    ) => void;
}) {
    const t = useTranslations("UserLocation");
    const containerRef = useRef<HTMLDivElement>(null);
    const [isFollowing, setIsFollowing] = useState(false);
    const followingRef = useRef(false);
    const hasInitializedFollowingRef = useRef(false);

    const centerOnUser = () => {
        if (userLocation) {
            mapRef.current?.flyTo({
                center: [userLocation.lng, userLocation.lat],
                zoom: 15,
                duration: 1200,
            });
            setIsFollowing(!isFollowing);
            followingRef.current = !isFollowing;
        } else {
            onLocationRequest((location) => {
                mapRef.current?.flyTo({
                    center: [location.lng, location.lat],
                    zoom: 15,
                    duration: 1200,
                });
                setIsFollowing(true);
                followingRef.current = true;
            });
        }
    };

    useEffect(() => {
        if (isFollowing && userLocation && mapRef.current) {
            mapRef.current.easeTo({
                center: [userLocation.lng, userLocation.lat],
                duration: 500,
            });
        }
    }, [userLocation, isFollowing, mapRef]);

    useEffect(() => {
        if (
            hasPermission &&
            userLocation &&
            !hasInitializedFollowingRef.current &&
            mapRef.current
        ) {
            hasInitializedFollowingRef.current = true;
            setIsFollowing(true);
            followingRef.current = true;
            mapRef.current.flyTo({
                center: [userLocation.lng, userLocation.lat],
                zoom: 15,
                duration: 1200,
            });
        }
    }, [hasPermission, userLocation, mapRef]);

    const handleMapMove = useCallback(() => {
        if (followingRef.current) {
            setIsFollowing(false);
            followingRef.current = false;
        }
    }, []);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        map.on("dragstart", handleMapMove);
        map.on("zoomstart", handleMapMove);

        return () => {
            map.off("dragstart", handleMapMove);
            map.off("zoomstart", handleMapMove);
        };
    }, [mapRef, handleMapMove]);

    useEffect(() => {
        if (!containerRef.current) return;
        const container = containerRef.current;
        const handleClick = (e: MouseEvent) => e.preventDefault();
        container.addEventListener("click", handleClick);
        container.addEventListener("wheel", handleClick);
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
                              ? t("center_map_on_user")
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

export function UserLocation({
    mapRef,
}: {
    mapRef: React.RefObject<MapRef | null>;
}) {
    const {
        location: userLocation,
        getCurrentPosition,
        hasPermission,
        isLoading,
        hasError,
    } = useGeolocation();

    return (
        <>
            {userLocation && (
                <Source
                    id="user-location-source"
                    type="geojson"
                    data={{
                        type: "Feature",
                        properties: {},
                        geometry: {
                            type: "Point",
                            coordinates: [userLocation.lng, userLocation.lat],
                        },
                    }}
                >
                    <Layer
                        id="user-location-layer"
                        type="symbol"
                        layout={{
                            "icon-image": "user-location-icon",
                            "icon-size": 1,
                            "icon-allow-overlap": true,
                        }}
                    />
                </Source>
            )}

            <LocationButton
                mapRef={mapRef}
                userLocation={userLocation}
                hasPermission={hasPermission}
                isLoading={isLoading}
                hasError={hasError}
                onLocationRequest={getCurrentPosition}
            />
        </>
    );
}

export { USER_LOCATION_SVG };
