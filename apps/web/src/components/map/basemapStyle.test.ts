import { COLORS } from "@megisholavonat/core/tokens";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { basemapTransform, mapStyle, SLOTS } from "./basemapStyle";

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
        const out = basemapTransform()(undefined, basemap);
        expect(ids(out)).toEqual([
            "background",
            "highway_motorway_inner",
            "road_oneway",
            SLOTS.railway,
            "place_city",
            "place_country",
            SLOTS.trainText,
            SLOTS.names,
            SLOTS.route,
            SLOTS.stops,
            SLOTS.station,
            SLOTS.trains,
        ]);
    });

    it("keeps the overlay under the names across a theme switch", () => {
        const light = basemapTransform()(undefined, basemap);
        // The app adds its overlay before the railway slot, a train on top
        const at = ids(light).indexOf(SLOTS.railway);
        light.layers.splice(at, 0, layer("railway-layer", { type: "raster" }));
        light.layers.push(layer("marker-dot", { type: "circle" }));
        const dark = basemapTransform()(light, basemap);
        expect(ids(dark)).toEqual([
            "background",
            "highway_motorway_inner",
            "road_oneway",
            "railway-layer",
            SLOTS.railway,
            "place_city",
            "place_country",
            SLOTS.trainText,
            SLOTS.names,
            SLOTS.route,
            SLOTS.stops,
            SLOTS.station,
            SLOTS.trains,
            "marker-dot",
        ]);
    });

    it("draws our style: land in the token colour, names over the slot", () => {
        for (const scheme of ["light", "dark"] as const) {
            const out = basemapTransform()(undefined, mapStyle(scheme, "hu"));
            const at = (id: string) => ids(out).indexOf(id);
            const background = out.layers[0];
            expect(background?.paint).toMatchObject({
                "background-color": COLORS[scheme].map,
            });
            expect(at("border")).toBeLessThan(at(SLOTS.railway));
            expect(at("place-city")).toBeGreaterThan(at(SLOTS.railway));
            expect(at(SLOTS.route)).toBeGreaterThan(at("water-name"));
            // No POIs, shields or road names: the only names are places
            const symbols = out.layers.filter((l) => l.type === "symbol");
            expect(
                symbols.map(
                    (l) => (l as { "source-layer"?: string })["source-layer"],
                ),
            ).toEqual([
                "place",
                "place",
                "place",
                "place",
                "place",
                "water_name",
            ]);
        }
    });

    it("names places in the page's language", () => {
        const en = mapStyle("light", "en");
        const city = en.layers.find((l) => l.id === "place-city");
        expect(JSON.stringify(city?.layout)).toContain("name_en");
    });
});
