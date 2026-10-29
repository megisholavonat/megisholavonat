import type { RunSummary } from "@megisholavonat/api-client";
import { describe, expect, it } from "vitest";
import {
    clockTime,
    delaySummary,
    delaySummaryPath,
    delaySummarySentence,
    delaySummaryShareText,
    delaySummaryUrl,
    huDayOn,
    isRunDate,
    isStationId,
    isTrainNumber,
    runDate,
    runDay,
    summaryLevel,
} from "./delaySummary";

const H = 3600;
// Thursday 2026-10-29, 10:00 in Budapest
const NOW = new Date("2026-10-29T09:00:00Z");

const SZOLNOK = "005513748";
const CEGLED = "005513102";
const NYUGATI = "005510033";

function run(
    delays: (number | null)[],
    extra: Partial<RunSummary> = {},
): RunSummary {
    const stops = [
        [SZOLNOK, "Szolnok", 7 * H + 15 * 60],
        [CEGLED, "Cegléd", 7 * H + 40 * 60],
        [NYUGATI, "Budapest-Nyugati", 8 * H + 30 * 60],
    ] as const;
    return {
        trainNumber: "2614",
        tripShortName: "2614 személyvonat",
        routeShortName: null,
        lineName: null,
        serviceDate: "2026-10-29",
        complete: true,
        cancelled: false,
        finished: true,
        reason: null,
        stops: stops.map(([stationId, name, t], i) => ({
            stationId,
            name,
            scheduledArrivalS: t,
            scheduledDepartureS: t,
            delayMin: delays[i] ?? null,
            cancelled: false,
        })),
        ...extra,
    };
}

describe("delaySummaryPath", () => {
    it("keeps valid stops only", () => {
        expect(
            delaySummaryPath("hu", "2614", "2026-10-29", {
                from: SZOLNOK,
                to: "x<y",
            }),
        ).toBe(`/hu/kesesek/2614/2026-10-29?from=${SZOLNOK}`);
        expect(delaySummaryPath("en", "H8000", "2026-10-29")).toBe(
            "/en/kesesek/H8000/2026-10-29",
        );
        expect(
            delaySummaryUrl(
                "https://megisholavonat.info/",
                "hu",
                "10",
                "2026-10-28",
            ),
        ).toBe("https://megisholavonat.info/hu/kesesek/10/2026-10-28");
    });

    it("validates link parts", () => {
        expect(isTrainNumber("H8000")).toBe(true);
        expect(isTrainNumber("26 14")).toBe(false);
        expect(isTrainNumber("")).toBe(false);
        expect(isStationId(SZOLNOK)).toBe(true);
        expect(isStationId("1:005513748")).toBe(false);
        expect(isRunDate("2026-10-29")).toBe(true);
        expect(isRunDate("2026-02-30")).toBe(false);
        expect(isRunDate("2026-10-29x")).toBe(false);
    });
});

describe("runDate", () => {
    function trip(serviceDate: string, first: number, last: number) {
        return {
            serviceDate,
            stoptimes: [
                { scheduledDeparture: first, scheduledArrival: first },
                { scheduledDeparture: last, scheduledArrival: last },
            ],
        };
    }

    it("is OTP's date for a daytime train", () => {
        expect(runDate(trip("2026-10-29", 7 * H, 8 * H), NOW)).toBe(
            "2026-10-29",
        );
    });

    it("moves a HÉV after midnight to the day it runs", () => {
        // OTP dates Thursday's 00:20 HÉV as Wednesday, stoptimes under 86400
        const now = new Date("2026-10-28T23:30:00Z"); // Thu 00:30
        expect(runDate(trip("2026-10-28", 1200, 3000), now)).toBe("2026-10-29");
    });

    it("moves train 10 back to the evening it leaves", () => {
        // OTP dates Thursday's 22:40 train 10 as Friday; now Fri 03:00
        const now = new Date("2026-10-30T02:00:00Z");
        expect(runDate(trip("2026-10-30", 81600, 99420), now)).toBe(
            "2026-10-29",
        );
    });
});

describe("delaySummary", () => {
    it("tells the arrival at the destination", () => {
        const card = delaySummary(run([1, 4, 23]));
        expect(card).toMatchObject({
            outcome: "late",
            delay: 23,
            level: "moderate",
            soFar: false,
            measuredAt: null,
            from: { name: "Szolnok", scheduled: 7 * H + 15 * 60 },
            to: {
                name: "Budapest-Nyugati",
                scheduled: 8 * H + 30 * 60,
                actual: 8 * H + 53 * 60,
            },
        });
    });

    it("tells the rider's own stops", () => {
        const card = delaySummary(run([1, 7.4, 23]), {
            from: SZOLNOK,
            to: CEGLED,
        });
        expect(card.to.name).toBe("Cegléd");
        expect(card.delay).toBe(7);
        expect(card.level).toBe("slight");
    });

    it("is on time up to five minutes", () => {
        expect(delaySummary(run([0, 0, 5])).outcome).toBe("onTime");
        expect(delaySummary(run([0, 0, 5])).level).toBe("onTime");
        expect(delaySummary(run([0, 0, 5.6])).outcome).toBe("late");
        expect(delaySummary(run([0, 0, -2])).delay).toBe(0);
        expect(summaryLevel(5)).toBe("onTime");
        expect(summaryLevel(6)).toBe("slight");
    });

    it("tells the delay so far while on its way", () => {
        const card = delaySummary(run([3, 12, null], { finished: false }));
        expect(card).toMatchObject({
            outcome: "late",
            delay: 12,
            soFar: true,
            measuredAt: { name: "Cegléd" },
        });
    });

    it("falls back to the last measured stop of a finished run", () => {
        const card = delaySummary(run([3, 12, null]));
        expect(card.soFar).toBe(false);
        expect(card.measuredAt?.name).toBe("Cegléd");
    });

    it("is cancelled when the run or the rider's stop is", () => {
        expect(
            delaySummary(run([null, null, null], { cancelled: true })).outcome,
        ).toBe("cancelled");
        const partly = run([1, null, null]);
        const nyugati = partly.stops[2];
        if (nyugati) nyugati.cancelled = true;
        expect(delaySummary(partly).outcome).toBe("cancelled");
        // Cegléd was not recorded: the last measurement before it stands in
        expect(delaySummary(partly, { to: CEGLED })).toMatchObject({
            outcome: "onTime",
            measuredAt: { name: "Szolnok" },
        });
    });

    it("is unknown without a measurement", () => {
        const card = delaySummary(run([null, null, null], { finished: false }));
        expect(card.outcome).toBe("unknown");
        expect(card.delay).toBeNull();
    });

    it("ignores stops not on the route or in the wrong order", () => {
        const card = delaySummary(run([1, 2, 30]), {
            from: CEGLED,
            to: SZOLNOK,
        });
        expect(card.from.name).toBe("Cegléd");
        expect(card.to.name).toBe("Budapest-Nyugati");
    });

    it("keeps the reason", () => {
        const card = delaySummary(
            run([1, 2, 30], {
                reason: { code: "track", label: "Pálya állapota" },
            }),
        );
        expect(card.reason).toBe("track");
    });
});

describe("copy", () => {
    it("says it in natural Hungarian", () => {
        expect(
            delaySummarySentence("hu", delaySummary(run([1, 4, 23])), NOW),
        ).toBe("A 7:15-ös Szolnok → Budapest-Nyugati ma 23 percet késett");
        expect(
            delaySummarySentence("hu", delaySummary(run([1, 4, 3])), NOW),
        ).toBe("A 7:15-ös Szolnok → Budapest-Nyugati ma pontosan érkezett");
        expect(
            delaySummarySentence(
                "hu",
                delaySummary(run([3, 12, null], { finished: false })),
                NOW,
            ),
        ).toBe(
            "A 7:15-ös Szolnok → Budapest-Nyugati ma eddig 12 percet késett",
        );
        expect(
            delaySummarySentence(
                "hu",
                delaySummary(run([null, null, null], { cancelled: true })),
                NOW,
            ),
        ).toBe("A 7:15-ös Szolnok → Budapest-Nyugati ma elmaradt");
        expect(
            delaySummarySentence(
                "hu",
                delaySummary(run([1, 8, 9], { serviceDate: "2026-10-27" })),
                NOW,
            ),
        ).toBe(
            "A 7:15-ös Szolnok → Budapest-Nyugati október 27-én 9 percet késett",
        );
    });

    it("says it in English", () => {
        expect(
            delaySummarySentence("en", delaySummary(run([1, 4, 23])), NOW),
        ).toBe("The 7:15 Szolnok → Budapest-Nyugati was 23 min late today");
        expect(
            delaySummarySentence(
                "en",
                delaySummary(run([1, 4, 2], { serviceDate: "2026-10-28" })),
                NOW,
            ),
        ).toBe("The 7:15 Szolnok → Budapest-Nyugati was on time yesterday");
        expect(
            delaySummarySentence(
                "en",
                delaySummary(run([null, null, null], { finished: false })),
                NOW,
            ),
        ).toBe("The 7:15 Szolnok → Budapest-Nyugati: no delay measured today");
    });

    it("says whose measurement it is", () => {
        expect(
            delaySummaryShareText("hu", delaySummary(run([1, 4, 23])), NOW),
        ).toMatch(/\(Mégis hol a vonat\? GPS-mérés\)$/);
    });

    it("picks the article and suffix by the time", () => {
        const at = (s: number) => {
            const r = run([0, 0, 30]);
            const first = r.stops[0];
            if (first) first.scheduledDepartureS = s;
            return delaySummarySentence("hu", delaySummary(r), NOW).split(
                " Szolnok",
            )[0];
        };
        expect(at(5 * H + 15 * 60)).toBe("Az 5:15-ös");
        expect(at(7 * H + 30 * 60)).toBe("A 7:30-as");
        expect(at(1 * H + 40 * 60)).toBe("Az 1:40-es");
        expect(at(7 * H)).toBe("A 7 órás");
        expect(at(11 * H + 5 * 60)).toBe("A 11:05-ös");
        // After midnight on the service day's clock
        expect(at(24 * H + 20 * 60)).toBe("A 0:20-as");
    });

    it("tells the day", () => {
        expect(runDay("hu", "2026-10-29", NOW)).toBe("ma");
        expect(runDay("hu", "2026-10-28", NOW)).toBe("tegnap");
        expect(runDay("hu", "2026-10-01", NOW)).toBe("október 1-jén");
        expect(runDay("en", "2026-09-03", NOW)).toBe("on 3 September");
        expect([2, 3, 4, 6, 10, 12, 20, 21, 22, 23, 30].map(huDayOn)).toEqual([
            "2-án",
            "3-án",
            "4-én",
            "6-án",
            "10-én",
            "12-én",
            "20-án",
            "21-én",
            "22-én",
            "23-án",
            "30-án",
        ]);
        expect(clockTime(7 * H + 5 * 60)).toBe("7:05");
    });
});
