import { describe, expect, it } from "vitest";
import { rankStations } from "./useSearch";

const station = (id: string, name: string) => ({ id, name, lat: 0, lon: 0 });

describe("rankStations", () => {
    it("drops kilometre posts and foreign platforms for a number", () => {
        const found = [
            station("005500001", "Km. 107+000 H."),
            station("008000001", "München Hbf Gl.5-10"),
            station("005500002", "Budapest-Keleti"),
        ];
        expect(rankStations(found, "10").map((s) => s.name)).toEqual([
            "Budapest-Keleti",
        ]);
        expect(rankStations(found, "km")).toHaveLength(3);
    });

    it("puts the main stations a query starts first", () => {
        const found = [
            station("005500003", "Budafok"),
            station("005510017", "Budapest-Keleti"),
        ];
        expect(rankStations(found, "bud")[0]?.name).toBe("Budapest-Keleti");
    });
});
