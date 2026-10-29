import type { VehiclePositionWithDelay } from "@megisholavonat/api-client";
import { describe, expect, it } from "vitest";
import type { LiveFollow } from "../follow/live";
import { type LocalFollow, type Run, stopOptions } from "../follow/model";
import {
    activityAttributes,
    activityState,
    badgeOf,
    liveActivityDefault,
    liveState,
    platformOfStop,
    scheduledState,
    updateDue,
    wantsActivity,
    widgetRuns,
} from "./model";

const H = 3600;
const MIN = 60_000;

function stop(name: string, uic: string, time: number, platform: string) {
    return {
        scheduledArrival: time - 60,
        scheduledDeparture: time,
        realtimeArrival: time - 60,
        realtimeDeparture: time,
        stop: {
            name,
            lat: 47,
            lon: 19,
            gtfsId: `1:${uic}_${platform}`,
            stationUicPricingCode: uic,
            platformCode: platform,
        },
    };
}

function details(nextStopIndex: number, delay = 0): VehiclePositionWithDelay {
    return {
        vehicleId: "v1",
        delay,
        activity: "running",
        trip: {
            gtfsId: "1:trip",
            serviceDate: "2026-10-29",
            tripShortName: "2423 személyvonat",
            route: { shortName: "S70" },
            stoptimes: [
                stop("Budapest-Nyugati", "005510009", 17 * H, "5"),
                stop("Újpest", "005510017", 17 * H + 24 * 60, "2"),
                stop("Dunakeszi", "005510025", 17 * H + 35 * 60, "1"),
                stop("Vác", "005510033", 18 * H, "3"),
            ],
        },
        vehicleProgress: { nextStopIndex },
    } as unknown as VehiclePositionWithDelay;
}

// 2026-10-29 in Budapest is CET (UTC+1)
const at = (hhmm: string) => new Date(`2026-10-29T${hhmm}:00+01:00`);
const unix = (hhmm: string) => at(hhmm).getTime() / 1000;

function follow(patch: Partial<LocalFollow> = {}): LocalFollow {
    return {
        id: "f1",
        kind: "trip",
        tripShortName: "2423 személyvonat",
        routeShortName: "S70",
        stops: stopOptions(details(1)),
        from: 1,
        to: 3,
        weekdays: [],
        tripId: "1:trip",
        serviceDate: "2026-10-29",
        vehicleId: "v1",
        delayThresholdMin: 5,
        notifyPlatformChange: true,
        liveActivity: true,
        ...patch,
    };
}

const run: Run = {
    serviceDate: "2026-10-29",
    departure: at("17:24").getTime(),
    dayOffset: 0,
};

describe("labels", () => {
    it("reads the platform of a platform-level stop", () => {
        expect(platformOfStop("1:005501024_14")).toBe("14");
        expect(platformOfStop("1:005505876_5b")).toBe("5b");
        expect(platformOfStop("1:005501024")).toBeNull();
        expect(platformOfStop(null)).toBeNull();
    });

    it("badges the line, else the number", () => {
        expect(badgeOf(follow())).toBe("S70");
        expect(badgeOf(follow({ routeShortName: null }))).toBe("2423");
    });

    it("builds the attributes with a follow link", () => {
        expect(activityAttributes(follow())).toEqual({
            followId: "f1",
            badge: "S70",
            title: "2423 → Vác",
            from: "Újpest",
            to: "Vác",
            url: "megisholavonat://followed/f1",
        });
    });
});

describe("content state", () => {
    it("shows the boarding stop from the timetable before the train is live", () => {
        expect(scheduledState(follow(), run)).toEqual({
            delayMin: null,
            nextStop: "Újpest",
            nextStopAt: unix("17:24"),
            platform: "2",
            platformSure: true,
            eta: unix("17:59"),
            progress: 0,
            departed: false,
        });
    });

    it("shows the boarding stop with the delay until the train leaves it", () => {
        const state = liveState(follow(), details(1, 6), at("17:10"));
        expect(state).toMatchObject({
            delayMin: 6,
            nextStop: "Újpest",
            nextStopAt: unix("17:30"),
            platform: "2",
            eta: unix("18:05"),
            progress: 0,
            departed: false,
            finished: false,
        });
    });

    it("then the next stop and the ride's progress", () => {
        const state = liveState(follow(), details(2, 6), at("17:45"));
        expect(state).toMatchObject({
            nextStop: "Dunakeszi",
            // Arrival 17:34 + 6
            nextStopAt: unix("17:40"),
            platform: "1",
            departed: true,
        });
        // 15 of 35 minutes from Újpest (17:30) to Vác (18:05)
        expect(state?.progress).toBe(0.43);
    });

    it("is finished past the alighting stop", () => {
        const done = { ...details(3), activity: "arrived" };
        const state = liveState(
            follow(),
            done as VehiclePositionWithDelay,
            at("18:10"),
        );
        expect(state).toMatchObject({ finished: true, progress: 1 });
    });

    it("never shows a negative delay", () => {
        expect(liveState(follow(), details(1, -2), at("17:10"))?.delayMin).toBe(
            0,
        );
    });

    it("falls back to the timetable for a train not calling at the stops", () => {
        const other = follow({
            stops: follow().stops.map((s) => ({ ...s, stationId: "x" })),
        });
        const live = { vehicleId: "v1", details: details(1), board: null };
        expect(liveState(other, details(1), at("17:10"))).toBeNull();
        expect(
            activityState(other, run, live, at("17:10")).delayMin,
        ).toBeNull();
    });
});

describe("when an activity runs", () => {
    it("runs near today's departure until after arrival, when turned on", () => {
        expect(wantsActivity(follow(), run, at("14:23"))).toBe(false);
        expect(wantsActivity(follow(), run, at("14:25"))).toBe(true);
        expect(wantsActivity(follow(), run, at("19:00"))).toBe(true);
        expect(wantsActivity(follow(), run, at("20:01"))).toBe(false);
        expect(wantsActivity(follow(), run, at("17:50"), true)).toBe(false);
        expect(
            wantsActivity(follow({ liveActivity: false }), run, at("17:00")),
        ).toBe(false);
        expect(
            wantsActivity(follow(), { ...run, dayOffset: 1 }, at("17:00")),
        ).toBe(false);
        expect(wantsActivity(follow(), null, at("17:00"))).toBe(false);
    });

    it("is on by default only for a single trip leaving soon", () => {
        const now = at("16:00");
        expect(liveActivityDefault([], at("17:24").getTime(), now)).toBe(true);
        expect(liveActivityDefault([], at("19:24").getTime(), now)).toBe(false);
        expect(liveActivityDefault([1], at("17:24").getTime(), now)).toBe(
            false,
        );
        expect(liveActivityDefault([], null, now)).toBe(false);
    });
});

describe("local updates", () => {
    const a = scheduledState(follow(), run);

    it("go out at once for meaningful changes, else once a minute", () => {
        expect(updateDue(a, undefined, undefined, 0)).toBe(true);
        expect(updateDue(a, a, 0, 10 * MIN)).toBe(false);
        const moved = { ...a, progress: 0.2 };
        expect(updateDue(moved, a, 0, 30_000)).toBe(false);
        expect(updateDue(moved, a, 0, MIN)).toBe(true);
        expect(updateDue({ ...a, delayMin: 3 }, a, 0, 1000)).toBe(true);
        expect(updateDue({ ...a, platform: "4" }, a, 0, 1000)).toBe(true);
    });
});

describe("widget data", () => {
    it("lists the runs with the live delay and platform", () => {
        const live: LiveFollow = {
            vehicleId: "v1",
            details: details(1, 6),
            board: { delay: 6, platform: "4" } as LiveFollow["board"],
        };
        const later = follow({ id: "f2", routeShortName: null });
        expect(
            widgetRuns([
                { follow: follow(), run, live },
                { follow: later, run },
            ]),
        ).toEqual([
            {
                followId: "f1",
                badge: "S70",
                title: "2423 → Vác",
                station: "Újpest",
                departure: unix("17:24"),
                delayMin: 6,
                platform: "4",
                platformSure: true,
                url: "megisholavonat://followed/f1",
            },
            {
                followId: "f2",
                badge: "2423",
                title: "2423 → Vác",
                station: "Újpest",
                departure: unix("17:24"),
                delayMin: null,
                platform: "2",
                platformSure: true,
                url: "megisholavonat://followed/f2",
            },
        ]);
    });
});
