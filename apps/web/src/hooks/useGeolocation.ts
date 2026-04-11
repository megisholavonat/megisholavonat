import { useCallback, useEffect, useRef, useState } from "react";

export function useGeolocation() {
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
