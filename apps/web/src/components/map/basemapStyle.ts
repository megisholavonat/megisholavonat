import { COLORS, type ColorScheme } from "@megisholavonat/core/tokens";
import type {
    LayerSpecification,
    SourceSpecification,
    StyleSpecification,
} from "maplibre-gl";

export const STYLE_URLS: Record<ColorScheme, string> = {
    light: "https://tiles.openfreemap.org/styles/positron",
    dark: "https://tiles.openfreemap.org/styles/dark",
};

/**
 * Empty, hidden layers that hold the draw order: overlays added later go
 * below their slot, so the route, stops and station never cover the trains.
 * They are part of the style itself, so they exist before any app layer is
 * added, also after a theme switch.
 */
export const SLOTS = {
    route: "slot-route",
    stops: "slot-stops",
    station: "slot-station",
    trains: "slot-trains",
} as const;

/** Marks the basemap's own layers, so the app's can be told apart. */
const BASE_KEY = "mhav:base";

type Json = unknown;

/** `["get", from]` → `to`, anywhere in an expression. */
function replaceGet(value: Json, from: string, to: Json): Json {
    if (!Array.isArray(value)) return value;
    if (value.length === 2 && value[0] === "get" && value[1] === from) {
        return to;
    }
    return value.map((v) => replaceGet(v, from, to));
}

/** The basemap layer, localised and with its warnings fixed. */
function patchLayer(
    layer: LayerSpecification,
    scheme: ColorScheme,
    locale: string,
): LayerSpecification {
    const out = {
        ...layer,
        metadata: {
            ...(layer.metadata as object | undefined),
            [BASE_KEY]: true,
        },
    } as LayerSpecification;
    if (out.type === "background") {
        // The land colour the marker colours were checked against
        out.paint = { ...out.paint, "background-color": COLORS[scheme].map };
    }
    if (out.type === "symbol" && out.layout?.["text-field"]) {
        // Place names in the page's language (OpenMapTiles carries name:xx);
        // the local name where there is no translation
        const name =
            locale === "en"
                ? ["get", "name_en"]
                : ["coalesce", ["get", `name:${locale}`], ["get", "name"]];
        out.layout = {
            ...out.layout,
            "text-field": replaceGet(
                out.layout["text-field"],
                "name_en",
                name,
            ) as never,
        };
    }
    if ("filter" in out && out.filter) {
        // Road shields compare ref_length, which many roads lack: MapLibre
        // warned on every load. A missing length now just fails the filter.
        out.filter = replaceGet(out.filter, "ref_length", [
            "coalesce",
            ["get", "ref_length"],
            99,
        ]) as never;
    }
    return out;
}

const SLOT_LAYERS: LayerSpecification[] = Object.values(SLOTS).map((id) => ({
    id,
    type: "background",
    layout: { visibility: "none" },
}));

function isBase(layer: LayerSpecification): boolean {
    return !!(layer.metadata as Record<string, unknown> | undefined)?.[
        BASE_KEY
    ];
}

/**
 * MapLibre `transformStyle`: patches the basemap and adds the draw-order
 * slots. On a theme switch it carries the app's own sources and layers over
 * from the previous style, in their order, so nothing is removed and re-added.
 */
export function basemapTransform(scheme: ColorScheme, locale: string) {
    return (
        previous: StyleSpecification | undefined,
        next: StyleSpecification,
    ): StyleSpecification => {
        const base = next.layers.map((l) => patchLayer(l, scheme, locale));
        if (!previous) {
            return { ...next, layers: [...base, ...SLOT_LAYERS] };
        }
        const appLayers = previous.layers.filter((l) => !isBase(l));
        // Every source the basemap doesn't have is the app's
        const appSources: Record<string, SourceSpecification> = {};
        for (const [id, source] of Object.entries(previous.sources)) {
            if (!(id in next.sources)) appSources[id] = source;
        }
        const hasSlots = appLayers.some((l) => l.id === SLOTS.route);
        return {
            ...next,
            sources: { ...next.sources, ...appSources },
            layers: [...base, ...(hasSlots ? [] : SLOT_LAYERS), ...appLayers],
        };
    };
}
