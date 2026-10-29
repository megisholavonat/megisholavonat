import type { VehiclePositionWithDelay } from "@megisholavonat/api-client";
import { describe, expect, it } from "vitest";
import {
    beforeDeparture,
    isUsuallyLate,
    mainAlert,
    predictedPlatform,
    stopRows,
    trainTitle,
} from "./trainData";

function st(
    name: string,
    scheduled: number,
    realtime: number,
    extra: Record<string, unknown> = {},
) {
    return {
        scheduledArrival: scheduled,
        realtimeArrival: realtime,
        scheduledDeparture: scheduled + 60,
        realtimeDeparture: realtime + 60,
        stop: {
            name,
            lat: 47,
            lon: 19,
            stationUicPricingCode: `0055${name}`,
            platformCode: name === "B" ? "4" : null,
        },
        ...extra,
    };
}

const H = 3600;

function vehicle(
    nextStopIndex: number,
    delay: number,
    stoptimes = [
        st("A", 16 * H, 16 * H + 120),
        st("B", 17 * H, 17 * H + 23 * 60),
        st("C", 18 * H, 18 * H),
        st("D", 19 * H, 19 * H),
    ],
): VehiclePositionWithDelay {
    return {
        delay,
        lastUpdated: 0,
        vehicleProgress: {
            nextStopIndex,
            lastStop: "",
            nextStop: "",
            progress: 0,
        },
        trip: { serviceDate: "2026-08-14", stoptimes },
    } as unknown as VehiclePositionWithDelay;
}

describe("stopRows", () => {
    it("splits passed, next and upcoming stops", () => {
        const rows = stopRows(vehicle(2, 23));
        expect(rows.map((r) => r.state)).toEqual([
            "passed",
            "passed",
            "next",
            "upcoming",
        ]);
        expect(rows.map((r) => r.approximate)).toEqual([
            false,
            false,
            false,
            true,
        ]);
    });

    it("uses actual departures for passed stops", () => {
        const [a, b] = stopRows(vehicle(2, 23));
        expect(a).toMatchObject({ scheduled: 16 * H + 60, delay: 2 });
        expect(b).toMatchObject({ delay: 23, platform: "4" });
    });

    it("carries the live delay to the next stops' arrivals", () => {
        const [, , c, d] = stopRows(vehicle(2, 23));
        expect(c).toMatchObject({
            scheduled: 18 * H,
            expected: 18 * H + 23 * 60,
        });
        expect(d).toMatchObject({ scheduled: 19 * H, delay: 23, isLast: true });
    });

    it("prefers a per-stop predictedDelay when the API sends one", () => {
        const rows = stopRows(
            vehicle(1, 10, [
                st("A", 16 * H, 16 * H),
                st("B", 17 * H, 17 * H),
                st("C", 18 * H, 18 * H, { predictedDelay: 4 }),
            ]),
        );
        expect(rows.map((r) => r.delay)).toEqual([0, 10, 4]);
    });

    it("never forecasts an early train", () => {
        const [, b] = stopRows(vehicle(1, -3));
        expect(b?.delay).toBe(0);
    });
});

describe("trainTitle", () => {
    it("keeps proper train names and drops categories", () => {
        expect(trainTitle("10 TRANSCARPATHIA", "Záhony").name).toBe(
            "TRANSCARPATHIA",
        );
        expect(trainTitle("2010 személyvonat", "Esztergom")).toEqual({
            number: "2010",
            name: null,
            destination: "Esztergom",
        });
    });
});

describe("beforeDeparture", () => {
    it("is true until the first departure", () => {
        // 15:00 in Budapest (CEST)
        const at = new Date("2026-08-14T13:00:00Z");
        expect(beforeDeparture(vehicle(0, 0), at)).toBe(true);
        const later = new Date("2026-08-14T15:30:00Z");
        expect(beforeDeparture(vehicle(1, 0), later)).toBe(false);
    });
});

describe("isUsuallyLate", () => {
    it("needs a typical delay of 3+ minutes over 5+ runs", () => {
        expect(
            isUsuallyLate({
                n: 10,
                medianDelayMin: 8,
                insufficientData: false,
            }),
        ).toBe(true);
        expect(
            isUsuallyLate({
                n: 10,
                medianDelayMin: 2,
                insufficientData: false,
            }),
        ).toBe(false);
        expect(
            isUsuallyLate({ n: 4, medianDelayMin: 8, insufficientData: true }),
        ).toBe(false);
        expect(isUsuallyLate(undefined)).toBe(false);
    });
});

describe("predictedPlatform", () => {
    const predictions = [
        { trainNumber: "10", platform: "6", confidence: 0.85, n: 20 },
        { trainNumber: "12", platform: "2", confidence: 0.6, n: 20 },
    ];

    it("shows a platform only from 80 % confidence", () => {
        expect(predictedPlatform(predictions, "10")).toBe("6");
        expect(predictedPlatform(predictions, "12")).toBeNull();
        expect(predictedPlatform(undefined, "10")).toBeNull();
    });
});

describe("mainAlert", () => {
    it("prefers an alert with a known reason", () => {
        const alerts = [
            {
                alertDescriptionText: "Valami más",
                effectiveStartDate: 0,
                effectiveEndDate: 0,
            },
            {
                alertDescriptionText: " Pálya állapota miatti késés ",
                effectiveStartDate: 0,
                effectiveEndDate: 0,
                reason: { code: "track" as const, label: "Pálya állapota" },
            },
        ];
        expect(mainAlert(alerts)).toEqual({
            reason: { code: "track", label: "Pálya állapota" },
            text: "Pálya állapota miatti késés",
        });
        expect(mainAlert([])).toBeNull();
    });
});
