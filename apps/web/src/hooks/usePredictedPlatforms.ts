import type { StationPlatforms } from "@megisholavonat/api-client";
import { getStationPlatformsOptions } from "@megisholavonat/api-client/react-query";
import { DISPLAY_RULES } from "@megisholavonat/core/tokens";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

const HOUR = 60 * 60 * 1000;
const MIN_PLATFORM_RUNS = 5;

/**
 * Train number -> the platform it usually uses at a station, only when we
 * are sure enough to show it as "6?".
 */
export function predictedPlatformsOf(
    platforms: StationPlatforms | undefined,
): Map<string, string> {
    const map = new Map<string, string>();
    for (const p of platforms?.predictions ?? []) {
        if (
            p.confidence >= DISPLAY_RULES.predictedPlatform.minConfidence &&
            p.n >= MIN_PLATFORM_RUNS
        ) {
            map.set(p.trainNumber, p.platform);
        }
    }
    return map;
}

export function usePredictedPlatforms(stationId: string): Map<string, string> {
    const platforms = useQuery({
        ...getStationPlatformsOptions({ path: { stationId } }),
        staleTime: HOUR,
        retry: false,
    });
    return useMemo(
        () => predictedPlatformsOf(platforms.data),
        [platforms.data],
    );
}
