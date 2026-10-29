import type { TrainFeatureCollection } from "@megisholavonat/api-client";
import { describe, expect, it } from "vitest";
import { feedState } from "./feedState";

const feed = (extra: Partial<TrainFeatureCollection> = {}) =>
    ({
        timestamp: "2026-08-14T15:00:00Z",
        features: [],
        noDataReceived: false,
        dataAgeMinutes: 0,
        ...extra,
    }) as TrainFeatureCollection;

describe("feedState", () => {
    it("is loading, then offline when the first fetch fails", () => {
        expect(feedState(undefined, false, 0)).toEqual({ kind: "loading" });
        expect(feedState(undefined, true, 0)).toEqual({ kind: "offline" });
    });

    it("keeps showing cached trains when a refetch fails", () => {
        expect(feedState(feed(), true, 3)).toEqual({
            kind: "ok",
            staleMinutes: null,
        });
    });

    it("tells since when MÁV sends nothing", () => {
        expect(
            feedState(
                feed({ noDataReceived: true, dataAgeMinutes: 12 }),
                false,
                0,
            ),
        ).toEqual({
            kind: "sourceDown",
            sinceMs: Date.parse("2026-08-14T14:48:00Z"),
        });
    });

    it("is empty when no train runs", () => {
        expect(feedState(feed(), false, 0)).toEqual({ kind: "empty" });
    });

    it("flags a feed older than 5 minutes", () => {
        expect(feedState(feed({ dataAgeMinutes: 7 }), false, 4)).toEqual({
            kind: "ok",
            staleMinutes: 7,
        });
        expect(feedState(feed({ dataAgeMinutes: 5 }), false, 4)).toEqual({
            kind: "ok",
            staleMinutes: null,
        });
    });
});
