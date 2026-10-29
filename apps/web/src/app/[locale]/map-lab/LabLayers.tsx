"use client";

import type { ColorScheme } from "@megisholavonat/core/tokens";
import type { FeatureCollection } from "geojson";
import type { ExpressionSpecification } from "maplibre-gl";
import { useEffect, useMemo, useState } from "react";
import { Layer, Source } from "react-map-gl/maplibre";
import { SLOTS } from "@/components/map/basemapStyle";
import type { LabelMode, RailMode } from "./options";
import { type Palette, QUIET, TRANSIT } from "./palettes";
import type { Basemap } from "./styles";

type Expr = ExpressionSpecification;
const OFM_TILES = "https://tiles.openfreemap.org/planet";

export function labPalette(basemap: Basemap, scheme: ColorScheme): Palette {
    return basemap === "transit" ? TRANSIT[scheme] : QUIET[scheme];
}

/** Station tiers by trains a day: [min trains, dot from zoom, label from zoom] */
const TIERS = [
    { id: 1, min: 40, dot: 6.5, label: 7 },
    { id: 2, min: 20, dot: 8, label: 8.5 },
    { id: 3, min: 8, dot: 9.5, label: 10 },
    { id: 4, min: 0, dot: 11, label: 11.5 },
    // HÉV stops: from the city zooms on
    { id: 5, min: -1, dot: 11.5, label: 12.5 },
] as const;

type StationRow = [string, string, number, number, number];

function useJson<T>(url: string, enabled: boolean): T | null {
    const [data, setData] = useState<T | null>(null);
    useEffect(() => {
        if (!enabled || data) return;
        let cancelled = false;
        fetch(url)
            .then((r) => r.json())
            .then((d) => {
                if (!cancelled) setData(d as T);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [url, enabled, data]);
    return data;
}

/**
 * The lab's own rail network and station names, drawn between the basemap
 * and the trains:
 * - track: every running line from OpenFreeMap (OpenMapTiles
 *   `transportation`, class rail without service tracks), from z8, hairline
 * - network: the lines our trains run on, from their route polylines, width
 *   by how many trains use a piece (main lines thick, branches thin), at
 *   every zoom; the only rail data at country zoom
 * - stations: ours, by trains a day, or the basemap's railway POIs
 */
export function LabLayers({
    basemap,
    scheme,
    rail,
    labels,
    dim,
}: {
    basemap: Basemap;
    scheme: ColorScheme;
    rail: RailMode;
    labels: LabelMode;
    /** A train is selected in focus mode: the network steps back */
    dim: boolean;
}) {
    const p = labPalette(basemap, scheme);
    const network = useJson<FeatureCollection>(
        "/map-lab/network.json",
        rail === "ours",
    );
    const stationRows = useJson<StationRow[]>(
        "/map-lab/stations.json",
        labels === "ours",
    );
    const stations = useMemo((): FeatureCollection | null => {
        if (!stationRows) return null;
        return {
            type: "FeatureCollection",
            features: stationRows.map(([id, name, lat, lon, perDay]) => {
                const hev = / H$/.test(name);
                const tier = hev
                    ? 5
                    : (TIERS.find((t) => perDay >= t.min)?.id ?? 4);
                return {
                    type: "Feature",
                    id: Number(id),
                    geometry: { type: "Point", coordinates: [lon, lat] },
                    properties: {
                        name,
                        short: name.replace(/^Budapest-/, ""),
                        perDay,
                        tier,
                    },
                };
            }),
        };
    }, [stationRows]);

    const opacity = dim ? 0.3 : 1;
    const fade = { duration: 200, delay: 0 };
    const byN = (main: number, mid: number, minor: number): Expr =>
        [
            "case",
            ["==", ["get", "hev"], 1],
            minor,
            ["match", ["get", "n"], 10, main, 4, mid, minor],
        ] as unknown as Expr;
    const networkWidth: Expr = [
        "interpolate",
        ["linear"],
        ["zoom"],
        5,
        byN(1.6, 1, 0.6),
        8,
        byN(2.6, 1.7, 1.1),
        12,
        byN(3.4, 2.4, 1.6),
        15,
        byN(4.5, 3.2, 2.2),
    ] as unknown as Expr;

    return (
        <>
            {rail === "ours" && (
                <Source id="lab-omt" type="vector" url={OFM_TILES}>
                    <Layer
                        id="lab-track"
                        type="line"
                        source-layer="transportation"
                        beforeId={SLOTS.railway}
                        minzoom={8}
                        filter={[
                            "all",
                            ["==", ["get", "class"], "rail"],
                            [
                                "match",
                                ["get", "subclass"],
                                ["rail", "narrow_gauge"],
                                true,
                                false,
                            ],
                            ["!", ["has", "service"]],
                        ]}
                        layout={{ "line-join": "round" }}
                        paint={{
                            "line-color": p.track,
                            "line-width": [
                                "interpolate",
                                ["linear"],
                                ["zoom"],
                                8,
                                0.6,
                                12,
                                1.2,
                                16,
                                2,
                            ],
                            "line-opacity": opacity,
                            "line-opacity-transition": fade,
                        }}
                    />
                    <Layer
                        id="lab-track-hev"
                        type="line"
                        source-layer="transportation"
                        beforeId={SLOTS.railway}
                        minzoom={11}
                        filter={[
                            "all",
                            ["==", ["get", "class"], "transit"],
                            ["==", ["get", "subclass"], "light_rail"],
                            ["!", ["has", "service"]],
                        ]}
                        paint={{
                            "line-color": p.railMinor,
                            "line-width": 1,
                            "line-opacity": opacity,
                            "line-opacity-transition": fade,
                        }}
                    />
                </Source>
            )}
            {rail === "ours" && network && (
                <Source id="lab-network" type="geojson" data={network}>
                    <Layer
                        id="lab-network"
                        type="line"
                        beforeId={SLOTS.railway}
                        layout={{
                            "line-join": "round",
                            "line-cap": "round",
                            "line-sort-key": ["get", "n"],
                        }}
                        paint={{
                            "line-color": [
                                "match",
                                ["get", "n"],
                                1,
                                p.railMinor,
                                p.rail,
                            ],
                            "line-width": networkWidth,
                            "line-opacity": opacity,
                            "line-opacity-transition": fade,
                        }}
                    />
                </Source>
            )}
            {labels === "ours" && stations && (
                <Source id="lab-stations" type="geojson" data={stations}>
                    {TIERS.map((t) => (
                        <Layer
                            key={`dot-${t.id}`}
                            id={`lab-station-dot-${t.id}`}
                            type="circle"
                            beforeId={SLOTS.route}
                            minzoom={t.dot}
                            filter={["==", ["get", "tier"], t.id]}
                            paint={{
                                "circle-radius": [
                                    "interpolate",
                                    ["linear"],
                                    ["zoom"],
                                    6,
                                    t.id === 1 ? 2.5 : 2,
                                    12,
                                    t.id <= 2 ? 4.5 : 3.5,
                                    15,
                                    t.id <= 2 ? 6 : 5,
                                ],
                                "circle-color": p.stationFill,
                                "circle-stroke-color": p.stationStroke,
                                "circle-stroke-width": t.id <= 2 ? 1.5 : 1.2,
                                "circle-opacity": opacity,
                                "circle-stroke-opacity": opacity,
                                "circle-opacity-transition": fade,
                                "circle-stroke-opacity-transition": fade,
                            }}
                        />
                    ))}
                    {TIERS.map((t) => (
                        <Layer
                            key={`label-${t.id}`}
                            id={`lab-station-label-${t.id}`}
                            type="symbol"
                            beforeId={SLOTS.route}
                            minzoom={t.label}
                            filter={["==", ["get", "tier"], t.id]}
                            layout={{
                                "text-field": [
                                    "step",
                                    ["zoom"],
                                    ["get", "name"],
                                    10,
                                    ["get", "short"],
                                ],
                                "text-font": [
                                    t.id <= 2
                                        ? "Noto Sans Bold"
                                        : "Noto Sans Regular",
                                ],
                                "text-size": [
                                    "interpolate",
                                    ["linear"],
                                    ["zoom"],
                                    7,
                                    t.id === 1 ? 12 : 11,
                                    12,
                                    t.id <= 2 ? 14 : 12.5,
                                ],
                                "text-variable-anchor": [
                                    "left",
                                    "right",
                                    "top",
                                    "bottom",
                                ],
                                "text-radial-offset": 0.6,
                                "text-justify": "auto",
                                "text-max-width": 9,
                                "symbol-sort-key": ["-", 0, ["get", "perDay"]],
                            }}
                            paint={{
                                "text-color": p.stationLabel,
                                "text-halo-color": p.halo,
                                "text-halo-width": 1.6,
                                // The route's stops name themselves
                                "text-opacity": dim ? 0 : 1,
                                "text-opacity-transition": fade,
                            }}
                        />
                    ))}
                </Source>
            )}
            {labels === "poi" && (
                <Source id="lab-omt-poi" type="vector" url={OFM_TILES}>
                    <Layer
                        id="lab-poi-dot"
                        type="circle"
                        source-layer="poi"
                        beforeId={SLOTS.route}
                        filter={[
                            "all",
                            ["==", ["get", "class"], "railway"],
                            [
                                "match",
                                ["get", "subclass"],
                                ["station", "halt"],
                                true,
                                false,
                            ],
                        ]}
                        paint={{
                            "circle-radius": 3.5,
                            "circle-color": p.stationFill,
                            "circle-stroke-color": p.stationStroke,
                            "circle-stroke-width": 1.2,
                            "circle-opacity": opacity,
                            "circle-stroke-opacity": opacity,
                        }}
                    />
                    <Layer
                        id="lab-poi-label"
                        type="symbol"
                        source-layer="poi"
                        beforeId={SLOTS.route}
                        filter={[
                            "all",
                            ["==", ["get", "class"], "railway"],
                            [
                                "match",
                                ["get", "subclass"],
                                ["station", "halt"],
                                true,
                                false,
                            ],
                        ]}
                        layout={{
                            "text-field": ["get", "name"],
                            "text-font": ["Noto Sans Regular"],
                            "text-size": 12,
                            "text-variable-anchor": ["left", "right", "top"],
                            "text-radial-offset": 0.6,
                            "symbol-sort-key": ["get", "rank"],
                        }}
                        paint={{
                            "text-color": p.stationLabel,
                            "text-halo-color": p.halo,
                            "text-halo-width": 1.6,
                            "text-opacity": opacity,
                        }}
                    />
                </Source>
            )}
        </>
    );
}
