import { basemapStyle } from "@megisholavonat/core/mapStyle";
import { MARKER } from "@megisholavonat/core/tokens";
import {
    MAP_FOCUS,
    MAP_MARKS,
    markSizeAt,
} from "@megisholavonat/core/tokens/map";
import { describe, expect, it } from "vitest";
import {
    arrowDistance,
    basemapAnchors,
    CLUSTER_LAYER_IDS,
    clusterLayers,
    DELAY_TEXT_OFFSET,
    focusOpacity,
    mapDataUrls,
    PINNED_SOURCE,
    RAILWAY_NAMES_MIN_ZOOM,
    railwayTileUrl,
    routeLayers,
    stationMarkLayers,
    trainLayers,
} from "./mapStyle";
import { ARROW, MARK_SHAPES, markBox, ringReach, SPRITE_SIZE } from "./sprites";

describe("map style", () => {
    it("puts the network under the place names and the rest on top", () => {
        const style = basemapStyle("light", "hu");
        const { belowNames, top } = basemapAnchors(style as never);
        expect(belowNames).toBe("border");
        const ids = style.layers.map((l) => l.id);
        expect(ids[ids.indexOf(belowNames) + 1]).toBe("place-village");
        expect(top).toBe(ids[ids.length - 1]);
    });

    it("reads the network and stations from our API", () => {
        expect(mapDataUrls("https://megisholavonat.info/api/")).toEqual({
            network: "https://megisholavonat.info/api/v1/map/network",
            stations: "https://megisholavonat.info/api/v1/map/stations",
        });
    });

    it("routes railway tiles through the tile cache when configured", () => {
        expect(railwayTileUrl("https://tc.megisholavonat.info/")).toBe(
            "https://tc.megisholavonat.info/orm/{z}/{x}/{y}.png",
        );
        expect(railwayTileUrl()).toContain("tiles.openrailwaymap.org");
    });

    it("fades the other trains while one is selected, except followed ones", () => {
        expect(focusOpacity(null)).toBe(1);
        expect(focusOpacity("1:42")).toEqual([
            "case",
            ["any", ["==", ["get", "vehicleId"], "1:42"], ["get", "followed"]],
            1,
            MAP_FOCUS.othersOpacity,
        ]);
    });

    it("sizes every mark by zoom alone", () => {
        const { marks } = trainLayers({ scheme: "light", selectedId: null });
        expect(marks.layout?.["icon-size"]).toEqual([
            "interpolate",
            ["linear"],
            ["zoom"],
            ...MAP_MARKS.size.flatMap(([z, d]) => [z, d / SPRITE_SIZE]),
        ]);
    });

    it("places +N below the marks, from city zoom, clear of its mark", () => {
        const { text, marks } = trainLayers({
            scheme: "dark",
            selectedId: "x",
        });
        expect(text.minzoom).toBe(MAP_MARKS.delayTextMinZoom);
        expect(text.layout?.["text-allow-overlap"]).toBeUndefined();
        // The marks take part in placement from the same zoom
        expect(marks.layout?.["icon-ignore-placement"]).toEqual([
            "step",
            ["zoom"],
            true,
            MAP_MARKS.delayTextMinZoom,
            false,
        ]);
        expect(marks.layout?.["icon-allow-overlap"]).toBe(true);
        expect(text.layout?.["symbol-sort-key"]).toEqual([
            "-",
            0,
            ["get", "delay"],
        ]);
        // At z13 a round mark's box is 22 px: 11 + 2 px gap = 13 px of 11 px
        const offset = DELAY_TEXT_OFFSET as unknown[];
        const z13 = offset[offset.indexOf(13) + 1] as unknown[];
        const half = markBox("train").w / 2;
        expect(z13[z13.length - 1]).toBeCloseTo(
            (half + MAP_MARKS.delayTextGap) / MAP_MARKS.delayTextSize,
            3,
        );
    });
});

describe("clusters", () => {
    it("draws piled-up trains as a neutral bubble with a count", () => {
        const { bubble, count } = clusterLayers({
            scheme: "dark",
            selectedId: null,
        });
        expect(bubble.id).toBe(CLUSTER_LAYER_IDS.bubble);
        expect(bubble.filter).toEqual(["has", "point_count"]);
        // Neutral: no delay colours (fade transitions aside)
        const colours = Object.entries(bubble.paint ?? {}).filter(
            ([key]) => !key.endsWith("-transition"),
        );
        expect(JSON.stringify(colours)).not.toMatch(/sev|delay/);
        expect(count.layout?.["text-field"]).toEqual([
            "get",
            "point_count_abbreviated",
        ]);
        // Only where trains truly pile up
        expect(MAP_MARKS.clusterMinPoints).toBeGreaterThanOrEqual(3);
    });

    it("keeps marks and numbers off the bubbles", () => {
        const layers = trainLayers({ scheme: "light", selectedId: null });
        expect(JSON.stringify(layers.marks.filter)).toContain("point_count");
        expect(JSON.stringify(layers.text.filter)).toContain("point_count");
    });

    it("gives the selected and followed trains their own layers", () => {
        const pinned = trainLayers({
            scheme: "light",
            selectedId: "x",
            source: PINNED_SOURCE,
            suffix: "-pinned",
        });
        expect(pinned.marks.source).toBe(PINNED_SOURCE);
        expect(pinned.marks.id).toBe("trains-pinned");
    });
});

describe("selected and followed trains", () => {
    const pinned = trainLayers({
        scheme: "light",
        selectedId: "x",
        source: PINNED_SOURCE,
        suffix: "-pinned",
        dimmed: false,
    });

    it("points the selected train's arrow ahead of it, clear of the ring", () => {
        expect(pinned.arrow.minzoom).toBe(MARKER.labelMinZoom);
        expect(pinned.arrow.layout?.["icon-image"]).toBe("mhav-light-arrow");
        expect(pinned.arrow.layout?.["icon-rotate"]).toEqual([
            "get",
            "heading",
        ]);
        expect(pinned.arrow.layout?.["icon-rotation-alignment"]).toBe("map");
        expect(JSON.stringify(pinned.arrow.filter)).toContain("moving");
        for (const shape of MARK_SHAPES) {
            for (const zoom of [9, 13, 16]) {
                const scale = markSizeAt(zoom) / SPRITE_SIZE;
                expect(arrowDistance(shape, zoom)).toBeGreaterThan(
                    ringReach(shape) * scale + ARROW.height / 2,
                );
            }
        }
    });

    it("stars followed trains as on the web", () => {
        expect(pinned.badge.type).toBe("symbol");
        expect(pinned.badge.layout?.["icon-image"]).toBe("mhav-light-follow");
        expect(pinned.badge.filter).toEqual(["==", ["get", "followed"], true]);
    });

    it("fades the others with a transition, the pinned ones not at all", () => {
        const base = trainLayers({
            scheme: "light",
            selectedId: "x",
            dimmed: true,
            fadeMs: 200,
        });
        expect(base.marks.paint?.["icon-opacity"]).toBe(
            MAP_FOCUS.othersOpacity,
        );
        expect(base.marks.paint?.["icon-opacity-transition"]).toEqual({
            duration: 200,
            delay: 0,
        });
        expect(pinned.marks.paint?.["icon-opacity"]).toBe(1);
    });
});

describe("route and station", () => {
    it("follows the station names setting and the overlay's own names", () => {
        const hidden = routeLayers("light", {
            names: false,
            namesOpacity: 0.4,
            railwayOverlay: true,
        });
        expect(hidden.stopLabels.layout?.visibility).toBe("none");
        expect(hidden.stopLabels.paint?.["text-opacity"]).toBe(0.4);
        expect(hidden.stopLabels.maxzoom).toBe(RAILWAY_NAMES_MIN_ZOOM);
        const shown = routeLayers("light");
        expect(shown.stopLabels.layout?.visibility).toBe("visible");
        expect(shown.stopLabels.maxzoom).toBeUndefined();
        // Sized as on the web
        expect(shown.stops.paint?.["circle-radius"]).toBe(4.5);
    });

    it("marks the chosen station with its clearing and ring", () => {
        const { clear, ring } = stationMarkLayers("dark");
        expect(clear.layout?.["icon-image"]).toBe("mhav-dark-station-clear");
        expect(ring.layout?.["icon-image"]).toBe("mhav-dark-station-ring");
    });
});
