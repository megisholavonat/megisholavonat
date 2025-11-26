import L from "leaflet";
import { LocateControl } from "leaflet.locatecontrol";
import "leaflet.locatecontrol/dist/L.Control.Locate.min.css";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef } from "react";
import { FaLocationArrow } from "react-icons/fa6";
import { useMap } from "react-leaflet";
import { Z_LAYERS } from "@/util/constants";

declare module "leaflet" {
    namespace control {
        // biome-ignore lint/suspicious/noExplicitAny: leaflet plugin
        function locate(options?: any): Locate;
    }

    class Locate extends Control {
        start(): void;
        stop(): void;
        setView(): void;
        _active: boolean;
    }
}

export function UserLocation() {
    const t = useTranslations("UserLocation");
    const map = useMap();
    const locateControlRef = useRef<L.Locate | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const handleClick = useCallback(() => {
        const control = locateControlRef.current;
        if (!control) return;

        if (!control._active) {
            control.start();
        } else {
            control.setView();
        }
    }, []);

    useEffect(() => {
        if (locateControlRef.current) {
            return;
        }

        const locateControl = new LocateControl({
            setView: "untilPanOrZoom",
            keepCurrentZoomLevel: false,
            drawMarker: true,
            drawCircle: true,
            showCompass: true,
            markerClass: L.CircleMarker,
            showPopup: false,
            locateOptions: {
                enableHighAccuracy: true,
                watch: true,
                timeout: 10000,
                maximumAge: 5000,
            },
            cacheLocation: true,
            onLocationError: (event: ErrorEvent, _control: LocateControl) => {
                const err = event as unknown as L.ErrorEvent;
                console.warn(err.message);
            },
        });

        locateControl.addTo(map);
        locateControlRef.current = locateControl as unknown as L.Locate;

        // Auto-start to show user location marker
        setTimeout(() => {
            locateControl.start();
        }, 100);

        return () => {
            if (locateControlRef.current) {
                locateControlRef.current.stop();
                locateControlRef.current.remove();
                locateControlRef.current = null;
            }
        };
    }, [map]);

    useEffect(() => {
        if (!containerRef.current) return;

        const container = containerRef.current;

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
    }, []);

    return (
        <div
            className="absolute top-34 left-3"
            style={{ zIndex: Z_LAYERS.MAP_CONTROLS }}
            ref={containerRef}
        >
            <motion.button
                onClick={handleClick}
                className="w-12 h-12 bg-white/95 dark:bg-card/95 backdrop-blur-md rounded-lg cursor-pointer shadow-lg border border-gray-200/50 dark:border-white/50 flex items-center justify-center group hover:bg-white dark:hover:bg-black"
                aria-label={t("locate")}
                whileHover={{
                    scale: 1.05,
                    boxShadow: "0 10px 25px rgba(0, 0, 0, 0.15)",
                }}
                whileTap={{
                    scale: 0.95,
                    transition: { duration: 0.1 },
                }}
                transition={{
                    type: "spring",
                    stiffness: 400,
                    damping: 17,
                }}
            >
                <FaLocationArrow className="scale-150 text-blue-600 dark:text-blue-400" />
            </motion.button>
        </div>
    );
}
