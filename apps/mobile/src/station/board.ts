import type {
    BoardEntry,
    PlatformPrediction,
} from "@megisholavonat/api-client";
import type { DelayReasonCode } from "@megisholavonat/core/delayReasons";
import { predictedPlatform, trainTitle } from "../train/trainData";

// Rows of the station board (design board 3). Pure, unit tested.

export interface BoardRow {
    key: string;
    /** Scheduled time, unix seconds */
    time: number;
    delay: number;
    /** No live data yet: no delay chip */
    realtime: boolean;
    canceled: boolean;
    /** Destination (departures) or origin (arrivals) */
    place: string;
    trainNumber: string;
    routeShortName: string;
    reason: DelayReasonCode | null;
    platform: string | null;
    /** `platform` is a ≥ 80 % prediction, shown as "6?" */
    predicted: boolean;
    /** Live on the map: opens the train sheet */
    vehicleId: string | null;
}

export function boardRows(
    entries: readonly BoardEntry[],
    predictions: readonly PlatformPrediction[] | undefined,
): BoardRow[] {
    return entries.map((e) => {
        const { number } = trainTitle(e.tripShortName, null);
        const predicted = e.platform
            ? null
            : predictedPlatform(predictions, number);
        return {
            key: `${e.tripId}-${e.serviceDate}`,
            time: e.scheduledTime,
            delay: Math.max(0, e.delayMinutes),
            realtime: e.realtime,
            canceled: e.canceled ?? false,
            place: e.headsign ?? "",
            trainNumber: number,
            routeShortName: e.routeShortName,
            reason: e.reason?.code ?? null,
            platform: e.platform ?? predicted,
            predicted: !e.platform && predicted !== null,
            vehicleId: e.vehicleId ?? null,
        };
    });
}
