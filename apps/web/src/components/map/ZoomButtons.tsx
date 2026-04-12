"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { FaMinus, FaPlus } from "react-icons/fa6";
import { useMap } from "react-map-gl/maplibre";
import { Z_LAYERS } from "@/util/constants";

export function ZoomButtons() {
    const t = useTranslations("ZoomButtons");
    const { current: mapRef } = useMap();
    const containerRef = useRef<HTMLDivElement>(null);

    const zoomIn = () => {
        const map = mapRef?.getMap();
        if (!map) return;
        map.zoomIn();
    };

    const zoomOut = () => {
        const map = mapRef?.getMap();
        if (!map) return;
        map.zoomOut();
    };

    useEffect(() => {
        if (!containerRef.current) return;
        const container = containerRef.current;
        const prevent = (e: Event) => e.stopPropagation();
        container.addEventListener("wheel", prevent);
        return () => {
            container.removeEventListener("wheel", prevent);
        };
    }, []);

    return (
        <div
            className="absolute top-3 left-3 flex flex-col space-y-1"
            style={{ zIndex: Z_LAYERS.MAP_CONTROLS }}
            ref={containerRef}
        >
            <motion.button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    zoomIn();
                }}
                className="w-12 h-12 bg-white/95 dark:bg-card/95 backdrop-blur-md rounded-lg cursor-pointer shadow-lg border border-gray-200/50 dark:border-white/50 flex items-center justify-center group hover:bg-white dark:hover:bg-black"
                aria-label={t("zoom_in")}
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
                <FaPlus className="scale-125 text-gray-600 dark:text-white group-hover:text-blue-600 dark:group-hover:text-white transition-colors" />
            </motion.button>

            <motion.button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    zoomOut();
                }}
                className="w-12 h-12 bg-white/95 dark:bg-card/95 backdrop-blur-md rounded-lg cursor-pointer shadow-lg border border-gray-200/50 dark:border-white/50 flex items-center justify-center group hover:bg-white dark:hover:bg-black"
                aria-label={t("zoom_out")}
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
                <FaMinus className="scale-125 text-gray-600 dark:text-white group-hover:text-blue-600 dark:group-hover:text-white transition-colors" />
            </motion.button>
        </div>
    );
}
