"use client";

import { LocateFixed, LocateOff, Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useMap } from "react-map-gl/maplibre";
import { useUserLocation } from "@/components/map/UserLocation";
import { cn } from "@/lib/utils";

/**
 * Bottom-right map buttons: locate (everywhere) and zoom (desktop). On phones
 * they float just above the bottom sheet (`--mhav-sheet-inset`).
 */
export function MapControls({
    isDesktop,
    skipInitialFly,
}: {
    isDesktop: boolean;
    skipInitialFly: boolean;
}) {
    const t = useTranslations("Map");
    const { current: map } = useMap();
    // Read once: re-creating the geolocate control on every selection would
    // drop the user's position
    const [disableInitialFly] = useState(skipInitialFly);
    const location = useUserLocation({ disableInitialFly });

    const locateLabel = location.hasError ? t("location_error") : t("locate");

    return (
        <div
            className={cn(
                "absolute right-4 z-10 flex flex-col items-end gap-2 transition-[bottom] duration-300 ease-sheet",
                isDesktop
                    ? "bottom-8"
                    : "bottom-[calc(var(--mhav-sheet-inset,0px)+2.25rem)]",
            )}
            onWheel={(e) => e.stopPropagation()}
        >
            <button
                type="button"
                className={cn(
                    "map-button",
                    isDesktop && "rounded-md",
                    location.hasLocation && "text-delay-on-time",
                    location.hasError && "text-ink-2",
                )}
                onClick={location.activate}
                disabled={location.isLoading}
                aria-label={locateLabel}
                title={locateLabel}
            >
                {location.hasError ? (
                    <LocateOff className="size-5" aria-hidden />
                ) : (
                    <LocateFixed
                        className={cn(
                            "size-5",
                            location.isLoading && "animate-pulse",
                        )}
                        aria-hidden
                    />
                )}
            </button>
            {isDesktop && (
                <div className="flex flex-col gap-2">
                    <button
                        type="button"
                        className="map-button rounded-md"
                        onClick={() => map?.zoomIn()}
                        aria-label={t("zoom_in")}
                        title={t("zoom_in")}
                    >
                        <Plus className="size-5" aria-hidden />
                    </button>
                    <button
                        type="button"
                        className="map-button rounded-md"
                        onClick={() => map?.zoomOut()}
                        aria-label={t("zoom_out")}
                        title={t("zoom_out")}
                    >
                        <Minus className="size-5" aria-hidden />
                    </button>
                </div>
            )}
        </div>
    );
}
