import type {
    TrainFeatureCollection,
    TrainFeatureProperties,
} from "@megisholavonat/api-client";
import { describe, expect, it } from "vitest";
import type { Follow } from "@/hooks/useFollows";
import { liveState } from "./useCommute";

const NOW_S = 1_793_000_000;
const DEPARTURE = NOW_S - 600;

const follow = {
    id: "f",
    trainNumber: "2010",
    fromStationId: "005510009",
    departureS: 0,
    weekdays: [4],
    date: null,
} as unknown as Follow;

const occurrence = {
    date: "2026-10-29",
    departure: DEPARTURE,
    daysAhead: 0,
    weekday: 4,
};

const trains = (
    props: Partial<TrainFeatureProperties>,
): TrainFeatureCollection =>
    ({
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                geometry: { type: "Point", coordinates: [19, 47] },
                properties: {
                    vehicleId: "v1",
                    tripShortName: "2010",
                    delay: 12,
                    lastUpdated: NOW_S - 20,
                    activity: "running",
                    isStale: false,
                    ...props,
                },
            },
        ],
    }) as unknown as TrainFeatureCollection;

const live = (props: Partial<TrainFeatureProperties>) =>
    liveState(follow, occurrence, undefined, trains(props), NOW_S, true).live;

describe("liveState", () => {
    it("shows the delay of a running train", () => {
        expect(live({})).toMatchObject({ delay: 12, stale: false });
    });

    it("shows no delay once the train has arrived", () => {
        expect(live({ activity: "arrived" })?.delay).toBeNull();
    });

    it("shows no delay before departure, early or not", () => {
        expect(
            live({ activity: "beforeDeparture", delay: -3 })?.delay,
        ).toBeNull();
    });

    it("marks a cancelled train cancelled, without a delay", () => {
        expect(live({ activity: "cancelled" })).toMatchObject({
            delay: null,
            canceled: true,
        });
    });

    it("greys a train without fresh positions", () => {
        expect(live({ lastUpdated: NOW_S - 20 * 60 })).toMatchObject({
            delay: 12,
            stale: true,
        });
    });
});
