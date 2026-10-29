import type { VehiclePositionWithDelay } from "@megisholavonat/api-client";
import { beforeDeparture } from "@megisholavonat/core/stops";
import { describe, expect, it } from "vitest";
import {
    isUsuallyLate,
    mainAlert,
    predictedPlatform,
    serviceGlyph,
    serviceGroups,
    sortedAlerts,
    stopRows,
    trainStop,
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

/** Stops without published realtime times */
const onTimeStops = [
    st("A", 16 * H, 16 * H),
    st("B", 17 * H, 17 * H),
    st("C", 18 * H, 18 * H),
];

/** The API's per-stop forecasts (minutes) on the processed stops. */
function withForecasts(
    details: VehiclePositionWithDelay,
    byIndex: Record<number, number>,
): VehiclePositionWithDelay {
    return {
        ...details,
        processedStops: Object.entries(byIndex).map(([index, delay]) => ({
            index: Number(index),
            predictedDelay: delay,
        })),
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
        // "≈" by the web's rule: our estimates ahead, the next stop too
        expect(rows.map((r) => r.approximate)).toEqual([
            false,
            false,
            true,
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

    it("prefers the per-stop predictedDelay of the processed stops", () => {
        const rows = stopRows(
            withForecasts(
                vehicle(1, 10, [
                    st("A", 16 * H, 16 * H),
                    st("B", 17 * H, 17 * H),
                    st("C", 18 * H, 18 * H),
                ]),
                { 2: 4 },
            ),
        );
        expect(rows.map((r) => r.delay)).toEqual([0, 10, 4]);
    });

    it("shows an early forecast as it is", () => {
        // Was clamped to the timetable's time before the web's rule
        const rows = stopRows(
            withForecasts(vehicle(1, 0, onTimeStops), { 2: -2 }),
        );
        expect(rows[2]).toMatchObject({
            delay: -2,
            expected: 18 * H - 120,
            approximate: true,
        });
    });

    it("never carries an early train's delay forward", () => {
        const [, b] = stopRows(vehicle(1, -3, onTimeStops));
        expect(b?.delay).toBe(0);
    });

    it("uses MÁV's realtime time for a stop ahead", () => {
        // B is ahead with a published +23; the GPS delay is +3. The app
        // used to show +3 here, the web +23.
        const [, b] = stopRows(vehicle(1, 3));
        expect(b).toMatchObject({
            state: "next",
            expected: 17 * H + 23 * 60,
            delay: 23,
            estimated: false,
            approximate: false,
        });
    });

    it("never leaves a stop before it arrives", () => {
        // A published departure before the published arrival
        const rows = stopRows(
            vehicle(1, 0, [
                st("A", 16 * H, 16 * H),
                st("B", 17 * H, 17 * H + 9 * 60, {
                    scheduledDeparture: 17 * H + 300,
                    realtimeDeparture: 17 * H + 5 * 60,
                }),
                st("C", 18 * H, 18 * H),
            ]),
        );
        expect(rows[1]?.secondary).toEqual({
            kind: "departure",
            expected: 17 * H + 9 * 60,
        });
    });

    it("passes every stop of an arrived train, with its actual arrival", () => {
        // The position still points at the final stop
        const rows = stopRows({ ...vehicle(3, 0), activity: "arrived" }, false);
        expect(rows.map((r) => r.state)).toEqual([
            "passed",
            "passed",
            "passed",
            "passed",
        ]);
        expect(rows[3]).toMatchObject({
            expected: 19 * H,
            approximate: false,
        });
    });

    it("waits at the first stop before departure", () => {
        const rows = stopRows(
            { ...vehicle(1, 0), activity: "beforeDeparture" },
            false,
        );
        expect(rows.map((r) => r.state)).toEqual([
            "next",
            "upcoming",
            "upcoming",
            "upcoming",
        ]);
        expect(rows[0]?.standing).toBe(true);
    });

    it("shows when a train standing out a stop leaves it", () => {
        // Past B's point on the route, but still standing there
        const rows = stopRows({ ...vehicle(2, 4), dwellStopIndex: 1 });
        expect(rows.map((r) => r.state)).toEqual([
            "passed",
            "next",
            "upcoming",
            "upcoming",
        ]);
        // Its published departure, +23 like its arrival (not the +4 GPS delay)
        expect(rows[1]).toMatchObject({
            standing: true,
            scheduled: 17 * H + 60,
            expected: 17 * H + 60 + 23 * 60,
            secondary: { kind: "arrival", expected: 17 * H + 23 * 60 },
        });
    });
});

describe("estimated stop times", () => {
    it("marks a forecast time ahead as estimated", () => {
        const rows = stopRows(vehicle(2, 23));
        // Passed stops have actual times; the live delay carried ahead is ours
        expect(rows.map((r) => r.estimated)).toEqual([
            false,
            false,
            true,
            true,
        ]);
    });

    it("tells the timetable's time plainly when there is no delay", () => {
        const waiting = stopRows(
            { ...vehicle(1, 0), activity: "beforeDeparture" },
            false,
        );
        expect(waiting[0]?.estimated).toBe(false);
        const onTime = stopRows(vehicle(2, 0));
        expect(onTime[2]?.estimated).toBe(false);
        // No "≈" ahead of an on-time train (the app used to mark every
        // stop beyond the next one)
        expect(onTime[3]?.approximate).toBe(false);
        // A per-stop forecast is one even at zero
        const predicted = stopRows(
            withForecasts(
                vehicle(1, 0, [
                    st("A", 16 * H, 16 * H),
                    st("B", 17 * H, 17 * H),
                ]),
                { 1: 0 },
            ),
        );
        expect(predicted[1]?.estimated).toBe(true);
    });

    it("marks the times ahead of a train without live data", () => {
        const rows = stopRows(vehicle(2, 0), true, true);
        expect(rows.map((r) => r.approximate)).toEqual([
            false,
            false,
            true,
            true,
        ]);
        // Not the first stop's departure, the timetable's time
        const waiting = stopRows(vehicle(0, 0, onTimeStops), false, true);
        expect(waiting[0]?.approximate).toBe(false);
    });
});

describe("trainStop", () => {
    it("follows the position while running", () => {
        expect(trainStop(vehicle(2, 0))).toEqual({
            next: 2,
            standing: null,
            arrived: false,
        });
    });

    it("ignores a dwell index off the trip", () => {
        expect(trainStop({ ...vehicle(2, 0), dwellStopIndex: 9 }).next).toBe(2);
    });
});

describe("trainTitle", () => {
    it("keeps proper train names and drops categories", () => {
        expect(trainTitle("10 TRANSCARPATHIA", "Záhony").name).toBe(
            "TRANSCARPATHIA",
        );
        // The category after the name used to hide it
        expect(trainTitle("10 TRANSCARPATHIA gyorsvonat", null).name).toBe(
            "TRANSCARPATHIA",
        );
        // A number that isn't all digits is the number, as on the web
        expect(trainTitle("H1500 HÉV", null)).toMatchObject({
            number: "H1500",
            name: "HÉV",
        });
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
        {
            trainNumber: "10",
            platform: "6",
            confidence: 0.85,
            n: 20,
            confident: true,
        },
        {
            trainNumber: "12",
            platform: "2",
            confidence: 0.6,
            n: 20,
            confident: false,
        },
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

describe("stopRows secondary times", () => {
    it("adds the departure of an upcoming stop where the train waits", () => {
        const rows = stopRows(
            vehicle(1, 10, [
                st("A", 16 * H, 16 * H),
                st("B", 17 * H, 17 * H, {
                    scheduledDeparture: 17 * H + 300,
                    realtimeDeparture: 17 * H + 300,
                }),
                st("C", 18 * H, 18 * H),
            ]),
        );
        expect(rows[1]?.secondary).toEqual({
            kind: "departure",
            expected: 17 * H + 300 + 600,
        });
        // First and last stops have only one time
        expect(rows[0]?.secondary).toBeNull();
        expect(rows[2]?.secondary).toBeNull();
    });

    it("adds the actual arrival of a passed stop", () => {
        const [, b] = stopRows(vehicle(2, 23));
        expect(b?.secondary).toEqual({
            kind: "arrival",
            expected: 17 * H + 23 * 60,
        });
    });

    it("shows one time for a short stop", () => {
        const rows = stopRows(
            vehicle(0, 0, [
                st("A", 16 * H, 16 * H),
                st("B", 17 * H, 17 * H, {
                    scheduledDeparture: 17 * H + 30,
                    realtimeDeparture: 17 * H + 30,
                }),
                st("C", 18 * H, 18 * H),
            ]),
        );
        expect(rows[1]?.secondary).toBeNull();
    });

    it("adds the departure where the train is held a minute or more", () => {
        // A short stop by the timetable, but MÁV expects it to leave 3
        // minutes after arriving: the app used to show one time
        const rows = stopRows(
            vehicle(0, 0, [
                st("A", 16 * H, 16 * H),
                st("B", 17 * H, 17 * H + 120, {
                    scheduledDeparture: 17 * H + 30,
                    realtimeDeparture: 17 * H + 300,
                }),
                st("C", 18 * H, 18 * H),
            ]),
        );
        expect(rows[1]?.secondary).toEqual({
            kind: "departure",
            expected: 17 * H + 300,
        });
    });

    it("doesn't carry a delay for a train not under way", () => {
        const [, , c] = stopRows(vehicle(2, 109), false);
        expect(c).toMatchObject({ delay: 0, expected: 18 * H });
    });
});

describe("sortedAlerts", () => {
    const alert = (text: string, reason = false) => ({
        alertDescriptionText: text,
        effectiveStartDate: 0,
        effectiveEndDate: 0,
        reason: reason
            ? { code: "other_train" as const, label: "Más vonat" }
            : null,
    });

    it("puts reasons first and drops repeated texts", () => {
        expect(
            sortedAlerts([
                alert("Pótlóbusz Vácon"),
                alert("Más vonat miatti késés", true),
                alert(" Pótlóbusz Vácon "),
            ]).map((a) => a.alertDescriptionText),
        ).toEqual(["Más vonat miatti késés", "Pótlóbusz Vácon"]);
    });
});

describe("serviceGroups", () => {
    const service = (
        name: string,
        from: number,
        till: number,
        shown = true,
    ) => ({
        name,
        fromStopIndex: from,
        tillStopIndex: till,
        fontCharSet: "MNR2007",
        fontCode: 100,
        displayable: shown,
    });

    it("splits whole-trip services from per-stop ones", () => {
        const groups = serviceGroups(
            [
                service("bike", 0, 3),
                service("buffet", 1, 2),
                service("hidden", 0, 3, false),
            ],
            4,
        );
        expect(groups.whole.map((s) => s.name)).toEqual(["bike"]);
        expect(groups.byStop.map((s) => s.map((x) => x.name))).toEqual([
            [],
            ["buffet"],
            ["buffet"],
            [],
        ]);
    });

    it("drops services the font has no glyph for", () => {
        const national = { ...service("Országos vonat", 0, 3), fontCode: 339 };
        expect(serviceGroups([national], 4).whole).toEqual([]);
    });

    it("draws the font glyph from the code", () => {
        expect(serviceGlyph(service("bike", 0, 1))).toBe("d");
    });
});
