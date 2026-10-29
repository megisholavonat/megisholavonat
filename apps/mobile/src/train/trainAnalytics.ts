import type { TrainFeatureCollection } from "@megisholavonat/api-client";
import { getTrainsOptions } from "@megisholavonat/api-client/react-query";
import { trainDisplay } from "@megisholavonat/core/display";
import { useEffect } from "react";
import { takeEntry, track } from "../analytics";
import { queryClient } from "../api";
import { getFollows } from "../follow/store";

/**
 * `train_opened` when the sheet opens (with the delay the map showed), and
 * `train_closed` with the time spent when it closes. The entry is read a
 * tick later, after the layout has noted a link or an alert.
 */
export function useTrainAnalytics(vehicleId: string) {
    useEffect(() => {
        const openedAt = Date.now();
        const timer = setTimeout(() => {
            const feed = queryClient.getQueryData<TrainFeatureCollection>(
                getTrainsOptions().queryKey,
            );
            const train = feed?.features.find(
                (f) => f.properties.vehicleId === vehicleId,
            )?.properties;
            const display = train ? trainDisplay(train) : null;
            track("train_opened", {
                entry: takeEntry() ?? "map",
                surface: "sheet",
                delay_level: display?.level ?? "unknown",
                state: display?.state ?? "unknown",
                followed: getFollows().some((f) => f.vehicleId === vehicleId),
                train_number: train?.tripShortName.trim().split(/\s+/, 1)[0],
                route: train?.routeShortName ?? undefined,
            });
        }, 0);
        return () => {
            clearTimeout(timer);
            track("train_closed", {
                surface: "sheet",
                dwell_s: (Date.now() - openedAt) / 1000,
            });
        };
    }, [vehicleId]);
}
