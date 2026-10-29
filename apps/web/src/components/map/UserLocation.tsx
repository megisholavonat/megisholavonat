"use client";

import { GeolocateControl, type GeolocatePositionEvent } from "maplibre-gl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMap } from "react-map-gl/maplibre";

type GeoCtrl = GeolocateControl & {
    _setup?: boolean;
    _container?: HTMLElement;
    _watchState?: string;
};

export interface UserLocationState {
    hasLocation: boolean;
    hasError: boolean;
    isLoading: boolean;
    activate: () => void;
}

/**
 * MapLibre's GeolocateControl with its own button hidden: draws the user's
 * position and returns the state for our locate button.
 */
export function useUserLocation({
    disableInitialFly = false,
}: {
    disableInitialFly?: boolean;
} = {}): UserLocationState {
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

        const ctrl = new GeolocateControl({
            positionOptions: { enableHighAccuracy: true },
            trackUserLocation: true,
            showUserLocation: true,
            showAccuracyCircle: true,
        }) as GeoCtrl;

        ctrl.on("geolocate", (e: GeolocatePositionEvent) => {
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
        const waitAndTrigger = () => {
            if (cancelled) return;
            if (ctrl._setup) {
                ctrl.trigger();
            } else {
                requestAnimationFrame(waitAndTrigger);
            }
        };

        // Only locate automatically if the user already granted permission
        // earlier; otherwise wait for them to tap the location button.
        const autoLocateIfGranted = async () => {
            try {
                const status = await navigator.permissions?.query({
                    name: "geolocation",
                });
                if (cancelled || status?.state !== "granted") return;
            } catch {
                return;
            }
            setIsLoading(true);
            requestAnimationFrame(waitAndTrigger);
        };
        void autoLocateIfGranted();

        return () => {
            cancelled = true;
            try {
                map.removeControl(ctrl);
            } catch {
                /* Map may already be removed (navigation / remount). */
            }
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
            // A user-initiated request should always fly to the location
            initialFlyHandledRef.current = true;
            setIsLoading(true);
            setHasError(false);
            ctrl.trigger();
        }
    }, [mapRef]);

    return { hasLocation, hasError, isLoading, activate: handleActivate };
}
