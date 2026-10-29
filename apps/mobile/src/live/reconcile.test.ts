import type { VehiclePositionWithDelay } from "@megisholavonat/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalFollow, Run } from "../follow/model";

// A fake native module recording the calls; the API's token registration
const fake = vi.hoisted(() => ({
    calls: [] as string[],
    running: [] as { id: string; followId: string; token?: string }[],
    enabled: true,
    tokens: [] as string[],
    widget: [] as string[],
}));

vi.mock("../../modules/live-activity", () => ({
    LiveActivity: {
        isEnabled: () => fake.enabled,
        list: () => fake.running,
        start: async (attributes: { followId: string }) => {
            fake.calls.push(`start ${attributes.followId}`);
            return `a-${attributes.followId}`;
        },
        update: async (id: string, state: { delayMin: number | null }) => {
            fake.calls.push(`update ${id} ${state.delayMin}`);
        },
        end: async (id: string, _state: unknown, immediately: boolean) => {
            fake.calls.push(`end ${id}${immediately ? " now" : ""}`);
        },
        setWidgetData: (json: string) => {
            fake.widget.push(json);
        },
    },
}));
vi.mock("react-native", () => ({ AppState: { currentState: "active" } }));
vi.mock("use-intl", () => ({ useLocale: () => "hu" }));
vi.mock("../follow/device", () => ({
    withDevice: async (
        _: string,
        call: (auth: string) => Promise<unknown>,
    ) => ({
        result: await call("d1"),
        replaced: false,
    }),
    isStatus: () => false,
}));
vi.mock("@megisholavonat/api-client", () => ({
    registerPushToken: async ({
        body,
    }: {
        body: { followId: string; token: string };
    }) => {
        fake.tokens.push(`${body.followId}:${body.token}`);
    },
}));

const H = 3600;
const at = (hhmm: string) => new Date(`2026-10-29T${hhmm}:00+01:00`);

function stop(name: string, uic: string, time: number) {
    return {
        scheduledArrival: time,
        scheduledDeparture: time,
        realtimeArrival: time,
        realtimeDeparture: time,
        stop: {
            name,
            gtfsId: `1:${uic}_1`,
            stationUicPricingCode: uic,
            platformCode: "1",
        },
    };
}

const stoptimes = [stop("Újpest", "u", 17 * H), stop("Vác", "v", 18 * H)];

function follow(id: string, liveActivity = true): LocalFollow {
    return {
        id,
        kind: "trip",
        tripShortName: "2423",
        routeShortName: "S70",
        stops: stoptimes.map((s) => ({
            stopId: s.stop.gtfsId,
            stationId: s.stop.stationUicPricingCode,
            name: s.stop.name,
            time: s.scheduledDeparture,
        })),
        from: 0,
        to: 1,
        weekdays: [],
        tripId: "1:t",
        serviceDate: "2026-10-29",
        vehicleId: null,
        delayThresholdMin: 5,
        notifyPlatformChange: true,
        liveActivity,
    };
}

const run: Run = {
    serviceDate: "2026-10-29",
    departure: at("17:00").getTime(),
    dayOffset: 0,
};

const details = (delay: number) =>
    ({
        vehicleId: "v1",
        delay,
        activity: "running",
        trip: { serviceDate: "2026-10-29", stoptimes },
        vehicleProgress: { nextStopIndex: 0 },
    }) as unknown as VehiclePositionWithDelay;

beforeEach(() => {
    vi.resetModules();
    fake.calls = [];
    fake.running = [];
    fake.enabled = true;
    fake.tokens = [];
    fake.widget = [];
});

describe("reconcileActivities", () => {
    it("starts turned-on runs near departure, from the foreground", async () => {
        const { reconcileActivities } = await import("./useLiveActivities");
        const items = [
            { follow: follow("f1"), run },
            { follow: follow("f2", false), run },
        ];
        await reconcileActivities(
            items,
            items.map((i) => i.follow),
            "hu",
            at("15:00"),
        );
        expect(fake.calls).toEqual(["start f1"]);
    });

    it("doesn't start when Live Activities are off", async () => {
        const { reconcileActivities } = await import("./useLiveActivities");
        fake.enabled = false;
        const items = [{ follow: follow("f1"), run }];
        await reconcileActivities(items, [follow("f1")], "hu", at("15:00"));
        expect(fake.calls).toEqual([]);
    });

    it("updates from live data only, registers the token once", async () => {
        const { reconcileActivities } = await import("./useLiveActivities");
        fake.running = [{ id: "a1", followId: "f1", token: "ab12" }];
        const f = follow("f1");
        // Not live yet: the pushed state is left alone
        await reconcileActivities([{ follow: f, run }], [f], "hu", at("16:50"));
        expect(fake.calls).toEqual([]);
        const live = { vehicleId: "v1", details: details(4), board: null };
        await reconcileActivities(
            [{ follow: f, run, live }],
            [f],
            "hu",
            at("16:51"),
        );
        // Same state again: nothing sent
        await reconcileActivities(
            [{ follow: f, run, live }],
            [f],
            "hu",
            at("16:51"),
        );
        expect(fake.calls).toEqual(["update a1 4"]);
        await new Promise((r) => setTimeout(r, 0));
        expect(fake.tokens).toEqual(["f1:ab12"]);
    });

    it("ends the activity of an unfollowed train at once", async () => {
        const { reconcileActivities } = await import("./useLiveActivities");
        fake.running = [{ id: "a1", followId: "gone" }];
        await reconcileActivities([], [], "hu", at("16:50"));
        expect(fake.calls).toEqual(["end a1 now"]);
    });

    it("ends it on arrival, leaving the final state up", async () => {
        const { reconcileActivities } = await import("./useLiveActivities");
        fake.running = [{ id: "a1", followId: "f1" }];
        const f = follow("f1");
        const arrived = {
            ...details(0),
            activity: "arrived",
        } as VehiclePositionWithDelay;
        await reconcileActivities(
            [
                {
                    follow: f,
                    run,
                    live: { vehicleId: "v1", details: arrived, board: null },
                },
            ],
            [f],
            "hu",
            at("18:01"),
        );
        expect(fake.calls).toEqual(["end a1"]);
    });
});

describe("writeWidget", () => {
    it("writes when the runs change, else every few minutes", async () => {
        const { writeWidget } = await import("./useLiveActivities");
        const items = [{ follow: follow("f1"), run }];
        writeWidget(items, at("15:00"));
        writeWidget(items, at("15:01"));
        expect(fake.widget).toHaveLength(1);
        expect(JSON.parse(fake.widget[0] ?? "")).toMatchObject({
            updatedAt: at("15:00").getTime() / 1000,
            runs: [{ followId: "f1", station: "Újpest", badge: "S70" }],
        });
        writeWidget([], at("15:02"));
        writeWidget([], at("15:08"));
        expect(fake.widget).toHaveLength(3);
    });
});
