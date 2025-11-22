"use client";

import { getTrainsOptions } from "@megisholavonat/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useState } from "react";
import Header from "@/components/ui/Header";

// Separate component for loading state
function MapLoading() {
    const t = useTranslations("Home");

    return (
        <div className="flex h-full w-full items-center justify-center bg-background">
            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                    duration: 0.5,
                    ease: "easeOut",
                }}
            >
                <p className="text-center text-2xl font-bold">
                    {t("loading_map")}
                </p>
            </motion.div>
        </div>
    );
}

const DynamicMap = dynamic(() => import("./MapComponent"), {
    ssr: false,
    loading: MapLoading,
});

export interface SearchSelection {
    vehicleId: string;
    timestamp: number;
}

export default function MapPage() {
    const [searchSelection, setSearchSelection] =
        useState<SearchSelection | null>(null);

    const { data } = useQuery({
        ...getTrainsOptions(),
        refetchInterval: 60 * 1000,
    });

    const clearSearchSelection = () => {
        setSearchSelection(null);
    };

    return (
        <div className="h-screen w-screen relative bg-background">
            <DynamicMap
                searchSelection={searchSelection}
                onClearSearchSelection={clearSearchSelection}
                data={data}
            />

            <Header
                data={data}
                onSearchResultClick={(vehicleId) => {
                    setSearchSelection({
                        vehicleId: vehicleId,
                        timestamp: Date.now(),
                    });
                }}
            />
        </div>
    );
}
