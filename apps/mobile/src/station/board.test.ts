import type { BoardEntry } from "@megisholavonat/api-client";
import { describe, expect, it } from "vitest";
import { boardRows } from "./board";

const entry = (extra: Partial<BoardEntry>): BoardEntry => ({
    tripId: "1:1",
    tripShortName: "924 InterCity",
    routeShortName: "",
    serviceDate: "2026-08-14",
    scheduledTime: 1000,
    expectedTime: 1000,
    delayMinutes: 0,
    delaySource: "otp",
    realtime: true,
    ...extra,
});

describe("boardRows", () => {
    const predictions = [
        { trainNumber: "924", platform: "8", confidence: 0.9, n: 30 },
        { trainNumber: "516", platform: "6", confidence: 0.5, n: 30 },
    ];

    it("shows the announced platform over a prediction", () => {
        const [row] = boardRows([entry({ platform: "9" })], predictions);
        expect(row).toMatchObject({ platform: "9", predicted: false });
    });

    it("predicts a platform from 80 % confidence only", () => {
        const [sure, unsure] = boardRows(
            [entry({}), entry({ tripShortName: "516", tripId: "1:2" })],
            predictions,
        );
        expect(sure).toMatchObject({ platform: "8", predicted: true });
        expect(unsure).toMatchObject({ platform: null, predicted: false });
    });

    it("carries reason, cancellation and the live vehicle", () => {
        const [row] = boardRows(
            [
                entry({
                    delayMinutes: 74,
                    canceled: true,
                    vehicleId: "1:42",
                    headsign: "Miskolc-Tiszai",
                    reason: { code: "technical", label: "Műszaki hiba" },
                }),
            ],
            undefined,
        );
        expect(row).toMatchObject({
            delay: 74,
            canceled: true,
            vehicleId: "1:42",
            place: "Miskolc-Tiszai",
            reason: "technical",
            trainNumber: "924",
        });
    });

    it("flags a train replaced by a bus", () => {
        const [bus, plain] = boardRows(
            [
                entry({ disruption: "replacement_bus" }),
                entry({ tripId: "1:2" }),
            ],
            undefined,
        );
        expect(bus?.disruption).toBe("replacement_bus");
        expect(plain?.disruption).toBeNull();
    });
});
