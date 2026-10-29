import { basemapStyle } from "@megisholavonat/core/mapStyle";
import type { ColorScheme } from "@megisholavonat/core/tokens";
import type {
    LayerSpecification,
    SourceSpecification,
    StyleSpecification,
} from "maplibre-gl";

/**
 * The basemap of a theme: our own quiet style over OpenFreeMap's vectors
 * (core/mapStyle, shared with the app), localised place names included.
 */
export function mapStyle(
    scheme: ColorScheme,
    locale: string,
): StyleSpecification {
    return basemapStyle(scheme, locale) as StyleSpecification;
}

/**
 * Empty, hidden layers that hold the draw order: overlays added later go
 * below their slot, so the route, stops and station never cover the trains.
 * They are part of the style itself, so they exist before any app layer is
 * added, also after a theme switch.
 */
export const SLOTS = {
    /**
     * Under the basemap's place names: the rail network and the optional
     * railway overlay never print over a city's name ("Buda•est")
     */
    railway: "slot-railway",
    /** Over the station dots: the trains' "+N" numbers */
    trainText: "slot-train-text",
    /**
     * Over the numbers: the station names, placed before any train so a
     * train never pushes a name away
     */
    names: "slot-names",
    route: "slot-route",
    stops: "slot-stops",
    station: "slot-station",
    trains: "slot-trains",
} as const;

/** Marks the basemap's own layers, so the app's can be told apart. */
const BASE_KEY = "mhav:base";

function markBase(layer: LayerSpecification): LayerSpecification {
    return {
        ...layer,
        metadata: {
            ...(layer.metadata as object | undefined),
            [BASE_KEY]: true,
        },
    } as LayerSpecification;
}

const slotLayer = (id: string): LayerSpecification => ({
    id,
    type: "background",
    layout: { visibility: "none" },
});
/** The slots above the whole basemap */
const TOP_SLOTS: LayerSpecification[] = Object.values(SLOTS)
    .filter((id) => id !== SLOTS.railway)
    .map(slotLayer);

/** Where the place names start: the railway slot goes right before them */
function placeNamesAt(layers: LayerSpecification[]): number {
    const at = layers.findIndex(
        (l) =>
            l.type === "symbol" &&
            (l as { "source-layer"?: string })["source-layer"] === "place",
    );
    return at === -1 ? layers.length : at;
}

function isBase(layer: LayerSpecification): boolean {
    return !!(layer.metadata as Record<string, unknown> | undefined)?.[
        BASE_KEY
    ];
}

/**
 * MapLibre `transformStyle`: marks the basemap's layers and adds the
 * draw-order slots. On a theme switch it carries the app's own sources and
 * layers over from the previous style, in their order, so nothing is removed
 * and re-added.
 */
export function basemapTransform() {
    return (
        previous: StyleSpecification | undefined,
        next: StyleSpecification,
    ): StyleSpecification => {
        const base = next.layers.map(markBase);
        const names = placeNamesAt(base);
        const below = base.slice(0, names);
        const above = base.slice(names);
        if (!previous) {
            return {
                ...next,
                layers: [
                    ...below,
                    slotLayer(SLOTS.railway),
                    ...above,
                    ...TOP_SLOTS,
                ],
            };
        }
        const appLayers = previous.layers.filter((l) => !isBase(l));
        // The app's layers up to the railway slot stay under the names
        const split = appLayers.findIndex((l) => l.id === SLOTS.railway) + 1;
        const under =
            split > 0 ? appLayers.slice(0, split) : [slotLayer(SLOTS.railway)];
        const over = split > 0 ? appLayers.slice(split) : appLayers;
        // Every source the basemap doesn't have is the app's
        const appSources: Record<string, SourceSpecification> = {};
        for (const [id, source] of Object.entries(previous.sources)) {
            if (!(id in next.sources)) appSources[id] = source;
        }
        const hasSlots = over.some((l) => l.id === SLOTS.route);
        return {
            ...next,
            sources: { ...next.sources, ...appSources },
            layers: [
                ...below,
                ...under,
                ...above,
                ...(hasSlots ? [] : TOP_SLOTS),
                ...over,
            ],
        };
    };
}
