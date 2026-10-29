import { describe, expect, it } from "vitest";
import { plannerFromParams, plannerParams } from "./PlannerButton";

describe("planner links", () => {
    it("round-trips a journey through the URL", () => {
        const state = plannerFromParams(
            new URLSearchParams(
                "from=budapest&to=005501289&time=2026-10-30T07:00&arriveBy=1",
            ),
        );
        expect(state).toEqual({
            from: {
                id: "budapest",
                name: "Budapest",
                lat: 47.497912,
                lon: 19.054916,
            },
            // Named once its board is loaded
            to: { id: "005501289", name: "", lat: 0, lon: 0 },
            time: "2026-10-30T07:00",
            arriveBy: true,
        });
        expect(state && plannerParams(state)).toEqual({
            from: "budapest",
            to: "005501289",
            time: "2026-10-30T07:00",
            arriveBy: "1",
        });
    });

    it("arrives by a set time only, as the time control does", () => {
        const state = plannerFromParams(
            new URLSearchParams("from=005510017&to=005517228&arriveBy=1"),
        );
        expect(state?.time).toBeNull();
        expect(state?.arriveBy).toBe(false);
        expect(
            plannerParams({
                from: null,
                to: null,
                time: null,
                arriveBy: true,
            }),
        ).toEqual({});
    });

    it("ignores what is not a station or a time", () => {
        expect(
            plannerFromParams(new URLSearchParams("vehicleId=42")),
        ).toBeNull();
        expect(
            plannerFromParams(new URLSearchParams("from=keleti&to=x")),
        ).toBeNull();
        expect(
            plannerFromParams(new URLSearchParams("to=005517228&time=now")),
        ).toEqual({
            from: null,
            to: { id: "005517228", name: "", lat: 0, lon: 0 },
            time: null,
            arriveBy: false,
        });
    });
});
