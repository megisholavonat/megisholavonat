"use client";

import maplibregl from "maplibre-gl";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { FaLocationArrow } from "react-icons/fa6";
import { MdLocationOff } from "react-icons/md";
import { useMap } from "react-map-gl/maplibre";
import { Z_LAYERS } from "@/util/constants";

type GeoCtrl = maplibregl.GeolocateControl & {
    _setup?: boolean;
    _container?: HTMLElement;
    _watchState?: string;
};

function LocationButton({
    hasLocation,
    hasError,
    isLoading,
    onActivate,
}: {
    hasLocation: boolean;
    hasError: boolean;
    isLoading: boolean;
    onActivate: () => void;
}) {
    const t = useTranslations("UserLocation");
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current) return;
        const container = containerRef.current;
        const prevent = (e: MouseEvent) => e.preventDefault();
        container.addEventListener("wheel", prevent);
        return () => container.removeEventListener("wheel", prevent);
    }, []);

    const iconClassName = () => {
        if (isLoading) return "scale-150 text-gray-500 dark:text-gray-400";
        if (hasError) return "scale-150 text-red-500 dark:text-red-400";
        if (hasLocation) return "scale-150 text-blue-600 dark:text-blue-400";
        return "scale-150 text-gray-700 dark:text-gray-300";
    };

    return (
        <div
            className="absolute top-34 left-3"
            style={{ zIndex: Z_LAYERS.MAP_CONTROLS }}
            ref={containerRef}
        >
            <div className="relative">
                <motion.button
                    onClick={onActivate}
                    disabled={isLoading}
                    className="w-12 h-12 bg-white/95 dark:bg-card/95 backdrop-blur-md rounded-lg cursor-pointer shadow-lg border border-gray-200/50 dark:border-white/50 flex items-center justify-center group hover:bg-white dark:hover:bg-black"
                    aria-label={
                        hasError
                            ? t("location_error")
                            : hasLocation
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
                            ? { scale: 0.95, transition: { duration: 0.1 } }
                            : {}
                    }
                    transition={{ type: "spring", stiffness: 400, damping: 17 }}
                >
                    {hasError ? (
                        <MdLocationOff className={iconClassName()} />
                    ) : (
                        <FaLocationArrow className={iconClassName()} />
                    )}
                </motion.button>

                <AnimatePresence>
                    {isLoading && (
                        <motion.div
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0, opacity: 0 }}
                            transition={{
                                type: "spring",
                                stiffness: 400,
                                damping: 17,
                            }}
                            className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-white dark:bg-card shadow-md flex items-center justify-center"
                        >
                            <div className="w-3 h-3 rounded-full border-2 border-gray-200 dark:border-gray-600 border-t-blue-500 dark:border-t-blue-400 animate-spin" />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}

export function UserLocation({
    disableInitialFly = false,
}: {
    disableInitialFly?: boolean;
}) {
    const { current: mapRef } = useMap();
    const [hasLocation, setHasLocation] = useState(false);
    const [hasError, setHasError] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const ctrlRef = useRef<GeoCtrl | null>(null);
    const lastPositionRef = useRef<{ lng: number; lat: number } | null>(null);
    const initialFlyHandledRef = useRef(false);

    useEffect(() => {
        const map = mapRef?.getMap();
        if (!map) return;

        const ctrl = new maplibregl.GeolocateControl({
            positionOptions: { enableHighAccuracy: true },
            trackUserLocation: true,
            showUserLocation: true,
            showAccuracyCircle: true,
        }) as GeoCtrl;

        ctrl.on("geolocate", (e: GeolocationPosition) => {
            // GeolocateControl calls flyTo() just before firing this event.
            // Calling map.stop() here cancels that animation before any frame
            // renders, so the map stays on the selected train.
            if (disableInitialFly && !initialFlyHandledRef.current) {
                initialFlyHandledRef.current = true;
                map.stop();
            }
            lastPositionRef.current = {
                lat: e.coords.latitude,
                lng: e.coords.longitude,
            };
            setIsLoading(false);
            setHasError(false);
            setHasLocation(true);
        });

        ctrl.on("error", () => {
            setIsLoading(false);
            setHasError(true);
            setHasLocation(false);
        });

        map.addControl(ctrl, "top-left");
        ctrlRef.current = ctrl;

        // Hide native button
        ctrl._container.style.visibility = "hidden";

        let cancelled = false;
        setIsLoading(true);
        const waitAndTrigger = () => {
            if (cancelled) return;
            if (ctrl._setup) {
                ctrl.trigger();
            } else {
                requestAnimationFrame(waitAndTrigger);
            }
        };
        requestAnimationFrame(waitAndTrigger);

        return () => {
            cancelled = true;
            map.removeControl(ctrl);
            ctrlRef.current = null;
        };
    }, [mapRef, disableInitialFly]);

    const handleActivate = useCallback(() => {
        const ctrl = ctrlRef.current;
        if (!ctrl) return;

        const pos = lastPositionRef.current;

        if (pos) {
            mapRef?.flyTo({
                center: [pos.lng, pos.lat],
                zoom: 15,
                duration: 1200,
            });
        } else {
            setIsLoading(true);
            setHasError(false);
            ctrl.trigger();
        }
    }, [mapRef]);

    return (
        <LocationButton
            hasLocation={hasLocation}
            hasError={hasError}
            isLoading={isLoading}
            onActivate={handleActivate}
        />
    );
}
