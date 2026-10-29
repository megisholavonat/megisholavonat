import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { basemapTransform, SLOTS } from "./basemapStyle";

const layer = (id: string, extra: object = {}) =>
    ({ id, type: "line", source: "base", ...extra }) as LayerSpecification;
const place = (id: string) =>
    layer(id, { type: "symbol", "source-layer": "place" });

const style = (layers: LayerSpecification[]): StyleSpecification => ({
    version: 8,
    sources: { base: { type: "vector" } },
    layers,
});

const ids = (s: StyleSpecification) => s.layers.map((l) => l.id);

describe("basemapTransform", () => {
    const basemap = style([
        layer("background", { type: "background" }),
        layer("highway_motorway_inner"),
        layer("road_oneway", { type: "symbol" }),
        place("place_city"),
        place("place_country"),
    ]);

    it("puts the railway slot under the place names, the rest on top", () => {
        const out = basemapTransform("light", "hu")(undefined, basemap);
        expect(ids(out)).toEqual([
            "background",
            "highway_motorway_inner",
            "road_oneway",
            SLOTS.railway,
            "place_city",
            "place_country",
            SLOTS.route,
            SLOTS.stops,
            SLOTS.station,
            SLOTS.trains,
        ]);
    });

    it("keeps the overlay under the names across a theme switch", () => {
        const light = basemapTransform("light", "hu")(undefined, basemap);
        // The app adds its overlay before the railway slot, a train on top
        const at = ids(light).indexOf(SLOTS.railway);
        light.layers.splice(at, 0, layer("railway-layer", { type: "raster" }));
        light.layers.push(layer("marker-dot", { type: "circle" }));
        const dark = basemapTransform("dark", "hu")(light, basemap);
        expect(ids(dark)).toEqual([
            "background",
            "highway_motorway_inner",
            "road_oneway",
            "railway-layer",
            SLOTS.railway,
            "place_city",
            "place_country",
            SLOTS.route,
            SLOTS.stops,
            SLOTS.station,
            SLOTS.trains,
            "marker-dot",
        ]);
    });

    it("hides one-way arrows and quiets dark motorways", () => {
        const dark = basemapTransform("dark", "hu")(undefined, basemap);
        const byId = (id: string) => dark.layers.find((l) => l.id === id);
        expect(byId("road_oneway")?.layout).toMatchObject({
            visibility: "none",
        });
        const paint = byId("highway_motorway_inner")?.paint as
            | Record<string, unknown>
            | undefined;
        expect(paint?.["line-color"]).not.toBe("#000");
    });
});
