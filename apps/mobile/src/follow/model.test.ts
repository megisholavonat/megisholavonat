import type { VehiclePositionWithDelay } from "@megisholavonat/api-client";
import { describe, expect, it } from "vitest";
import {
    createBody,
    defaultDraft,
    findFollowFor,
    isExpired,
    isRunOf,
    type LocalFollow,
    nextRun,
    parseFollows,
    stationIdOf,
    stopOptions,
    toggleWeekday,
    trainNumber,
    upcoming,
    withFrom,
} from "./model";

const H = 3600;

function stop(name: string, uic: string, time: number) {
    return {
        scheduledArrival: time - 60,
        scheduledDeparture: time,
        realtimeArrival: time - 60,
        realtimeDeparture: time,
        stop: {
            name,
            lat: 47,
            lon: 19,
            gtfsId: `1:${uic}_2`,
            stationUicPricingCode: uic,
        },
    };
}

function details(nextStopIndex = 1): VehiclePositionWithDelay {
    return {
        vehicleId: "v1",
        delay: 0,
        trip: {
            gtfsId: "1:trip",
            serviceDate: "2026-10-29",
            tripShortName: "2423 személyvonat",
            stoptimes: [
                stop("Budapest-Nyugati", "005510009", 17 * H),
                stop("Újpest", "005510017", 17 * H + 24 * 60),
                stop("Dunakeszi", "005510025", 17 * H + 35 * 60),
                stop("Vác", "005510033", 18 * H),
            ],
        },
        vehicleProgress: { nextStopIndex },
    } as unknown as VehiclePositionWithDelay;
}

function follow(patch: Partial<LocalFollow> = {}): LocalFollow {
    return {
        id: "f1",
        kind: "commute",
        tripShortName: "2423 személyvonat",
        routeShortName: null,
        stops: stopOptions(details()),
        from: 1,
        to: 3,
        weekdays: [1, 2, 3, 4, 5],
        tripId: "1:trip",
        serviceDate: null,
        vehicleId: null,
        delayThresholdMin: 5,
        notifyPlatformChange: true,
        ...patch,
    };
}

// Thursday 2026-10-29, 16:00 in Budapest (CET, UTC+1)
const THU_16 = new Date("2026-10-29T15:00:00Z");

describe("stations and numbers", () => {
    it("prefers the UIC code and falls back to the gtfsId", () => {
        expect(stationIdOf({ stationUicPricingCode: "005510017" })).toBe(
            "005510017",
        );
        expect(stationIdOf({ gtfsId: "1:005501024_14" })).toBe("005501024");
        expect(stationIdOf({})).toBeNull();
    });

    it("takes the number from the trip name", () => {
        expect(trainNumber("559 AGRIA InterRégió")).toBe("559");
    });
});

describe("draft", () => {
    it("never boards at a stop the train has passed", () => {
        expect(defaultDraft(details(2)).from).toBe(2);
        expect(defaultDraft(details(3)).from).toBe(2);
    });

    it("boards at the next stop and alights at the terminus", () => {
        expect(defaultDraft(details(1))).toMatchObject({
            weekdays: [],
            from: 1,
            to: 3,
            delayThresholdMin: 5,
        });
        // Never boards at the terminus
        expect(defaultDraft(details(3)).from).toBe(2);
    });

    it("keeps alighting after boarding", () => {
        const draft = defaultDraft(details(1));
        expect(withFrom({ ...draft, to: 2 }, 2).to).toBe(3);
    });

    it("toggles days in order", () => {
        expect(toggleWeekday([1, 5], 3)).toEqual([1, 3, 5]);
        expect(toggleWeekday([1, 3, 5], 3)).toEqual([1, 5]);
    });
});

describe("createBody", () => {
    const train = { ...follow(), tripId: "1:trip" };

    it("makes a trip follow without days", () => {
        expect(
            createBody(train, "2026-10-29", {
                ...defaultDraft(details()),
                weekdays: [],
            }),
        ).toMatchObject({
            kind: "trip",
            tripId: "1:trip",
            serviceDate: "2026-10-29",
            fromStopId: "1:005510017_2",
            toStopId: "1:005510033_2",
            delayThresholdMin: 5,
        });
    });

    it("makes a commute with days", () => {
        expect(
            createBody(train, null, {
                ...defaultDraft(details()),
                weekdays: [1, 5],
            }),
        ).toMatchObject({
            kind: "commute",
            weekdays: [1, 5],
            fromStationId: "005510017",
            toStationId: "005510033",
        });
    });

    it("refuses alighting before boarding", () => {
        expect(
            createBody(train, "2026-10-29", {
                ...defaultDraft(details()),
                from: 2,
                to: 1,
            }),
        ).toBeNull();
    });
});

describe("nextRun", () => {
    it("shows today's commute before it leaves", () => {
        const run = nextRun(follow(), THU_16);
        expect(run?.dayOffset).toBe(0);
        expect(run?.serviceDate).toBe("2026-10-29");
        expect(new Date(run?.departure ?? 0).toISOString()).toBe(
            "2026-10-29T16:24:00.000Z",
        );
    });

    it("moves on to the next commute day an hour after departure", () => {
        // Friday is next
        expect(
            nextRun(follow(), new Date("2026-10-29T17:30:00Z"))?.dayOffset,
        ).toBe(1);
        // Weekend skipped: Friday evening -> Monday
        expect(
            nextRun(follow(), new Date("2026-10-30T17:30:00Z"))?.dayOffset,
        ).toBe(3);
    });

    it("keeps a commute until it arrives", () => {
        // Újpest 17:24 -> Vác 18:00; Thursday 18:20 local
        const run = nextRun(follow(), new Date("2026-10-29T17:20:00Z"));
        expect(run?.dayOffset).toBe(0);
    });

    it("keeps today's run of a train followed after it left", () => {
        // Boarded at Budapest-Nyugati 17:00; 18:30 local, still running late
        const fromOrigin = follow({ from: 0 });
        const now = new Date("2026-10-29T17:30:00Z");
        expect(nextRun(fromOrigin, now)?.dayOffset).toBe(1);
        expect(nextRun(fromOrigin, now, true)).toMatchObject({
            dayOffset: 0,
            serviceDate: "2026-10-29",
        });
        expect(
            upcoming([fromOrigin], now, new Set(["2423"]))[0]?.run.dayOffset,
        ).toBe(0);
    });

    it("ends a trip after its arrival", () => {
        const trip = follow({
            kind: "trip",
            weekdays: [],
            serviceDate: "2026-10-29",
        });
        expect(nextRun(trip, THU_16)?.dayOffset).toBe(0);
        expect(nextRun(trip, new Date("2026-10-29T18:30:00Z"))).toBeNull();
    });

    it("sorts by departure", () => {
        const early = follow({ id: "early", from: 0 });
        const late = follow({ id: "late", from: 2 });
        expect(upcoming([late, early], THU_16).map((u) => u.follow.id)).toEqual(
            ["early", "late"],
        );
    });
});

describe("isRunOf", () => {
    it("matches a commute by number, date and boarding station", () => {
        expect(isRunOf(follow(), "2026-10-29", details(), THU_16)).toBe(true);
        expect(isRunOf(follow(), "2026-10-30", details(), THU_16)).toBe(false);
        const other = follow({ tripShortName: "2425" });
        expect(isRunOf(other, "2026-10-29", details(), THU_16)).toBe(false);
    });

    it("matches a trip by id", () => {
        const trip = follow({ kind: "trip", tripId: "1:other" });
        expect(isRunOf(trip, "2026-10-29", details(), THU_16)).toBe(false);
    });

    it("matches a trip only on its own day", () => {
        const yesterday = follow({
            kind: "trip",
            weekdays: [],
            serviceDate: "2026-10-28",
        });
        expect(findFollowFor([yesterday], details(), THU_16)).toBeNull();
        const today = { ...yesterday, serviceDate: "2026-10-29" };
        expect(findFollowFor([today], details(), THU_16)).toBe(today);
    });
});

describe("service-day quirks", () => {
    // A HÉV OTP dates Wednesday that leaves 00:20 on Thursday
    const hev = () =>
        ({
            vehicleId: "h1",
            delay: 0,
            trip: {
                gtfsId: "1:hev",
                serviceDate: "2026-10-28",
                tripShortName: "H5 1234",
                stoptimes: [
                    stop("Batthyány tér", "A", 20 * 60),
                    stop("Szentendre", "B", 60 * 60),
                ],
            },
        }) as unknown as VehiclePositionWithDelay;
    const THU_0010 = new Date("2026-10-28T23:10:00Z");

    it("shows a HÉV trip after midnight as tonight's", () => {
        const f = follow({
            kind: "trip",
            tripShortName: "H5 1234",
            tripId: "1:hev",
            stops: stopOptions(hev()),
            from: 0,
            to: 1,
            weekdays: [],
            serviceDate: "2026-10-28",
        });
        expect(nextRun(f, THU_0010)).toEqual({
            serviceDate: "2026-10-29",
            departure: Date.parse("2026-10-28T23:20:00Z"),
            dayOffset: 0,
        });
        expect(findFollowFor([f], hev(), THU_0010)).toBe(f);
    });

    it("finds a HÉV commute's live run after midnight", () => {
        const f = follow({
            tripShortName: "H5 1234",
            stops: stopOptions(hev()),
            from: 0,
            to: 1,
            weekdays: [4],
        });
        const run = nextRun(f, THU_0010, true);
        expect(run).toMatchObject({ serviceDate: "2026-10-29", dayOffset: 0 });
        expect(run && isRunOf(f, run.serviceDate, hev(), THU_0010)).toBe(true);
    });

    it("shows train 10 as today's while it runs", () => {
        // OTP dates Thursday's 23:00 train 10 as Friday
        const ten = {
            ...details(),
            trip: {
                ...details().trip,
                gtfsId: "1:ten",
                serviceDate: "2026-10-30",
                tripShortName: "10",
                stoptimes: [
                    stop("Budapest-Keleti", "005510009", 23 * H),
                    stop("Záhony", "005517228", 30 * H),
                ],
            },
        } as unknown as VehiclePositionWithDelay;
        const now = new Date("2026-10-29T22:30:00Z"); // Thu 23:30
        const trip = follow({
            kind: "trip",
            tripShortName: "10",
            tripId: "1:ten",
            stops: stopOptions(ten),
            from: 0,
            to: 1,
            weekdays: [],
            serviceDate: "2026-10-30",
        });
        expect(nextRun(trip, now)).toEqual({
            serviceDate: "2026-10-29",
            departure: Date.parse("2026-10-29T22:00:00Z"),
            dayOffset: 0,
        });
        const commute = { ...trip, kind: "commute" as const, weekdays: [4] };
        const run = nextRun(commute, now, true);
        expect(run).toMatchObject({ serviceDate: "2026-10-29", dayOffset: 0 });
        expect(run && isRunOf(commute, run.serviceDate, ten, now)).toBe(true);
    });
});

describe("storage", () => {
    it("round-trips and drops invalid entries", () => {
        const json = JSON.stringify([follow(), { id: 3 }, follow({ to: 9 })]);
        expect(parseFollows(json)).toEqual([follow()]);
        expect(parseFollows("not json")).toEqual([]);
    });

    it("expires trips from the day before yesterday", () => {
        const trip = follow({ kind: "trip", serviceDate: "2026-10-27" });
        expect(isExpired(trip, THU_16)).toBe(true);
        expect(isExpired({ ...trip, serviceDate: "2026-10-28" }, THU_16)).toBe(
            false,
        );
        expect(isExpired(follow(), THU_16)).toBe(false);
    });
});
