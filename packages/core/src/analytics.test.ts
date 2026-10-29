import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    type AnalyticsSink,
    createAnalytics,
    EVENT_SCHEMA,
    followsBucket,
    sanitizeEvent,
    sanitizeSuperProps,
} from "./analytics";

function recorder() {
    const events: {
        event: string;
        props: Record<string, unknown>;
        instant: boolean;
    }[] = [];
    const sink: AnalyticsSink = {
        capture: (event, props, { instant }) =>
            events.push({ event, props, instant }),
    };
    return { events, sink };
}

describe("sanitizeEvent", () => {
    it("keeps the declared properties", () => {
        expect(
            sanitizeEvent("search_result_selected", {
                type: "train",
                position: 2,
                query_length: 4,
                trains: 3,
                stations: 1,
            }),
        ).toEqual({
            type: "train",
            position: 2,
            query_length: 4,
            trains: 3,
            stations: 1,
        });
    });

    it("drops undeclared properties, such as a search query", () => {
        expect(
            sanitizeEvent("search_result_selected", {
                type: "station",
                query: "Szolnok",
                q: "x",
                lat: 47.1,
                lon: 20.2,
                email: "a@b.c",
            }),
        ).toEqual({ type: "station" });
    });

    it("drops values outside an enum and wrong types", () => {
        expect(
            sanitizeEvent("train_opened", {
                entry: "somewhere else",
                surface: 1,
                followed: "yes",
                delay_level: "severe",
            }),
        ).toEqual({ delay_level: "severe" });
    });

    it("rounds and clamps counts", () => {
        expect(sanitizeEvent("map_ready", { ms: 1234.6, trains: -4 })).toEqual({
            ms: 1235,
            trains: 0,
        });
        expect(sanitizeEvent("map_ready", { ms: 1e9 })).toEqual({
            ms: 120_000,
        });
        expect(sanitizeEvent("map_ready", { ms: Number.NaN })).toEqual({});
    });

    it("lets only short plain ids through, never free text", () => {
        expect(
            sanitizeEvent("station_opened", { station_id: "005513748" }),
        ).toEqual({ station_id: "005513748" });
        expect(
            sanitizeEvent("train_opened", {
                train_number: "8",
                route: "80a",
            }),
        ).toEqual({ train_number: "8", route: "80a" });
        for (const text of ["a@b.c", "Kossuth utca 1", "x".repeat(40), ""]) {
            expect(
                sanitizeEvent("station_opened", { station_id: text }),
            ).toEqual({});
        }
    });

    it("rejects unknown properties and events at compile time", () => {
        const analytics = createAnalytics("web");
        // @ts-expect-error: a search query is not a property of any event
        analytics.track("search_result_selected", { query: "Szolnok" });
        // @ts-expect-error: a value outside the enum
        analytics.track("train_opened", { entry: "elsewhere" });
        // @ts-expect-error: not an event
        analytics.track("page_text", {});
    });

    it("rejects unknown events", () => {
        expect(sanitizeEvent("$identify", { email: "a@b.c" })).toBeNull();
        expect(sanitizeEvent("toString")).toBeNull();
    });

    it("declares no property that could hold personal data", () => {
        const forbidden =
            /query(?!_length)|text|name|email|phone|lat|lon|position_|location|address|ip|user|device|token|from|to$|origin|destination/;
        for (const [event, props] of Object.entries(EVENT_SCHEMA)) {
            for (const key of Object.keys(props)) {
                expect(`${event}.${key}`).not.toMatch(
                    new RegExp(`\\.(${forbidden.source})`),
                );
            }
        }
    });
});

describe("sanitizeSuperProps", () => {
    it("keeps only the stable properties", () => {
        expect(
            sanitizeSuperProps({
                locale: "hu",
                theme: "dark",
                follows: "2-3",
                app_version: "0.1.0",
                distinct_id: "someone",
            }),
        ).toEqual({
            locale: "hu",
            theme: "dark",
            follows: "2-3",
            app_version: "0.1.0",
        });
    });
});

describe("followsBucket", () => {
    it.each([
        [0, "0"],
        [1, "1"],
        [2, "2-3"],
        [3, "2-3"],
        [4, "4+"],
        [40, "4+"],
    ])("%i follows → %s", (count, bucket) => {
        expect(followsBucket(count)).toBe(bucket);
    });
});

describe("createAnalytics", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("sends with the super properties and the platform", () => {
        const { events, sink } = recorder();
        const analytics = createAnalytics("web");
        analytics.attach(sink);
        analytics.setSuperProps({ locale: "en", follows: "1" });
        analytics.track("stats_viewed", { kind: "rankings" });
        expect(events).toEqual([
            {
                event: "stats_viewed",
                props: {
                    platform: "web",
                    locale: "en",
                    follows: "1",
                    kind: "rankings",
                },
                instant: false,
            },
        ]);
    });

    it("works without consent (anonymous mode)", () => {
        const { events, sink } = recorder();
        const analytics = createAnalytics("web");
        expect(analytics.getMode()).toBe("anonymous");
        analytics.attach(sink);
        analytics.track("app_open", { entry: "direct" });
        expect(events).toHaveLength(1);
    });

    it("sends nothing while off", () => {
        const { events, sink } = recorder();
        const analytics = createAnalytics("ios");
        analytics.setMode("off");
        analytics.attach(sink);
        analytics.track("app_open", { entry: "direct" });
        analytics.trackDebounced("sheet_detent_changed", { detent: "full" });
        vi.runAllTimers();
        expect(events).toEqual([]);
    });

    it("queues until attached, then sends in order", () => {
        const { events, sink } = recorder();
        const analytics = createAnalytics("web");
        analytics.track("app_open", { entry: "share_link" });
        analytics.track("map_ready", { ms: 900 });
        expect(events).toEqual([]);
        analytics.attach(sink);
        expect(events.map((e) => e.event)).toEqual(["app_open", "map_ready"]);
    });

    it("drops queued events when consent changes, so they are not linked", () => {
        const { events, sink } = recorder();
        const analytics = createAnalytics("web");
        analytics.track("app_open", { entry: "direct" });
        analytics.setMode("persistent");
        analytics.track("map_ready", { ms: 900 });
        analytics.attach(sink);
        expect(events.map((e) => e.event)).toEqual(["map_ready"]);
    });

    it("caps the queue", () => {
        const { events, sink } = recorder();
        const analytics = createAnalytics("web");
        for (let i = 0; i < 80; i++) analytics.track("search_opened");
        analytics.attach(sink);
        expect(events).toHaveLength(50);
    });

    it("passes the instant flag", () => {
        const { events, sink } = recorder();
        const analytics = createAnalytics("web");
        analytics.attach(sink);
        analytics.track(
            "consent_decided",
            { decision: "granted", source: "prompt" },
            { instant: true },
        );
        expect(events[0]?.instant).toBe(true);
    });

    it("debounces per event and key, the last call wins", () => {
        const { events, sink } = recorder();
        const analytics = createAnalytics("web");
        analytics.attach(sink);
        analytics.trackDebounced(
            "sheet_detent_changed",
            { sheet: "train", detent: "half" },
            500,
            "train",
        );
        analytics.trackDebounced(
            "sheet_detent_changed",
            { sheet: "train", detent: "full" },
            500,
            "train",
        );
        analytics.trackDebounced(
            "sheet_detent_changed",
            { sheet: "station", detent: "half" },
            500,
            "station",
        );
        vi.advanceTimersByTime(499);
        expect(events).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(events.map((e) => e.props.detent)).toEqual(["full", "half"]);
    });

    it("cannot override the platform", () => {
        const { events, sink } = recorder();
        const analytics = createAnalytics("android");
        analytics.attach(sink);
        analytics.setSuperProps({ platform: "web" });
        analytics.track("search_opened");
        expect(events[0]?.props.platform).toBe("android");
    });
});
