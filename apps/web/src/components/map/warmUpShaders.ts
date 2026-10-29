import type { LayerSpecification, Map as MaplibreMap } from "maplibre-gl";

const SOURCE = "mhav-warmup";

/**
 * WebGL compiles a layer type's shaders the first time it draws. Selecting a
 * train adds the route line, stop circles and stop names at once, and their
 * compiles (100+ ms on slow phones) landed inside the sheet's animation.
 * This draws the same layers once, nearly transparent, in idle time, then
 * removes them. Returns a cancel.
 */
export function warmUpShaders(
    map: MaplibreMap,
    layers: LayerSpecification[],
): () => void {
    let done = false;
    let handle: number | null = null;
    const cleanup = () => {
        done = true;
        try {
            for (const layer of layers) {
                if (map.getLayer(layer.id)) map.removeLayer(layer.id);
            }
            if (map.getSource(SOURCE)) map.removeSource(SOURCE);
        } catch {
            /* The map or its style is gone */
        }
    };
    const run = () => {
        handle = null;
        if (done) return;
        try {
            const { lng, lat } = map.getCenter();
            const d = 0.0005;
            map.addSource(SOURCE, {
                type: "geojson",
                data: {
                    type: "FeatureCollection",
                    features: [
                        {
                            type: "Feature",
                            properties: {},
                            geometry: {
                                type: "LineString",
                                coordinates: [
                                    [lng - d, lat],
                                    [lng + d, lat],
                                ],
                            },
                        },
                        {
                            type: "Feature",
                            properties: {
                                name: "·",
                                hasPassed: false,
                                level: "slight",
                                shape: "train",
                                label: "+5",
                            },
                            geometry: {
                                type: "Point",
                                coordinates: [lng, lat],
                            },
                        },
                    ],
                },
            });
            for (const layer of layers) map.addLayer(layer);
        } catch {
            cleanup();
            return;
        }
        // Drawn once the source's tile is parsed; then they can go
        let loaded = false;
        const onRender = () => {
            if (done) return;
            if (!loaded) {
                try {
                    loaded = map.isSourceLoaded(SOURCE);
                } catch {
                    loaded = true;
                }
                // The frame after the tile is in draws the layers
                if (loaded) map.triggerRepaint();
                return;
            }
            map.off("render", onRender);
            cleanup();
        };
        map.on("render", onRender);
        // Never leave them behind
        setTimeout(() => {
            map.off("render", onRender);
            cleanup();
        }, 5000);
    };
    handle =
        typeof requestIdleCallback === "function"
            ? requestIdleCallback(run, { timeout: 3000 })
            : (setTimeout(run, 500) as unknown as number);
    return () => {
        if (handle !== null) {
            if (typeof cancelIdleCallback === "function") {
                cancelIdleCallback(handle);
            } else clearTimeout(handle);
        }
        cleanup();
    };
}
