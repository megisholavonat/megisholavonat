import { describe, expect, it } from "vitest";
import { plannerFromLink } from "./link";

describe("plannerFromLink", () => {
    it("reads the stations, the Budapest time and arrive-by", () => {
        expect(
            plannerFromLink({
                from: "budapest",
                to: "005501289",
                time: "2026-10-30T07:00",
                arriveBy: "1",
            }),
        ).toEqual({
            from: {
                id: "budapest",
                name: "Budapest",
                lat: 47.497912,
                lon: 19.054916,
            },
            to: { id: "005501289", name: "", lat: 0, lon: 0 },
            // 07:00 CET
            time: Date.UTC(2026, 9, 30, 6, 0),
            arriveBy: true,
        });
    });

    it("leaves out what it does not understand", () => {
        expect(plannerFromLink({ to: "005517228", time: "tomorrow" })).toEqual({
            from: null,
            to: { id: "005517228", name: "", lat: 0, lon: 0 },
            time: null,
            arriveBy: false,
        });
        expect(plannerFromLink({ from: "keleti" })).toBeNull();
        expect(plannerFromLink({})).toBeNull();
    });
});
