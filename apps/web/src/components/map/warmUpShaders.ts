import type { LayerSpecification, Map as MaplibreMap } from "maplibre-gl";

const SOURCE = "mhav-warmup";
/** At a constant 0 these skip drawing, so nothing compiles yet */
const OPACITY = [
    "line-opacity",
    "circle-opacity",
    "circle-stroke-opacity",
    "icon-opacity",
    "text-opacity",
] as const;

/** WebGL renderers that run on the CPU: SwiftShader, Mesa's llvmpipe, ... */
const SOFTWARE_RENDERER =
    /swiftshader|llvmpipe|softpipe|software|basic render/i;

/**
 * Whether the map draws with a software renderer. There a shader compile is
 * CPU work on the page's own cores (several CPU seconds for these layers),
 * so compiling them all up front costs more than the stutter it saves.
 */
export function isSoftwareRenderer(map: MaplibreMap): boolean {
    try {
        const canvas = map.getCanvas();
        const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
        if (!gl) return false;
        const info = gl.getExtension("WEBGL_debug_renderer_info");
        const renderer = gl.getParameter(
            info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER,
        );
        return SOFTWARE_RENDERER.test(String(renderer));
    } catch {
        return false;
    }
}

/**
 * WebGL compiles a layer type's shaders the first time it draws. Selecting a
 * train adds the route line, stop circles and stop names at once, and their
 * compiles (100+ ms on slow phones) landed inside the sheet's animation.
 * This draws the same layers, nearly transparent, in idle time, then
 * removes them. They go in at once, at opacity 0 (parsed, not drawn), and
 * are shown one per idle period: drawing all of them in one frame was a
 * long task of its own on first load. Skipped on a software renderer.
 * Returns a cancel.
 */
export function warmUpShaders(
    map: MaplibreMap,
    layers: LayerSpecification[],
): () => void {
    if (isSoftwareRenderer(map)) return () => {};
    let done = false;
    let handle: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let onRender: (() => void) | null = null;
    const pending = [...layers];
    const added: string[] = [];

    const cleanup = () => {
        done = true;
        if (onRender) map.off("render", onRender);
        if (timer !== null) clearTimeout(timer);
        try {
            for (const id of added) {
                if (map.getLayer(id)) map.removeLayer(id);
            }
            if (map.getSource(SOURCE)) map.removeSource(SOURCE);
        } catch {
            /* The map or its style is gone */
        }
    };
    const idle = (fn: () => void) => {
        handle =
            typeof requestIdleCallback === "function"
                ? requestIdleCallback(
                      () => {
                          handle = null;
                          fn();
                      },
                      { timeout: 3000 },
                  )
                : (setTimeout(() => {
                      handle = null;
                      fn();
                  }, 500) as unknown as number);
    };
    /** Runs fn after the next frame is drawn */
    const afterDraw = (fn: () => void) => {
        onRender = () => {
            if (onRender) map.off("render", onRender);
            onRender = null;
            if (!done) idle(fn);
        };
        map.on("render", onRender);
        map.triggerRepaint();
    };

    const opacities = (layer: LayerSpecification) => {
        const paint = ("paint" in layer ? layer.paint : undefined) ?? {};
        return OPACITY.filter((key) => key in paint).map(
            (key) => [key, (paint as Record<string, number>)[key]] as const,
        );
    };

    const next = () => {
        if (done) return;
        const layer = pending.shift();
        if (!layer) {
            cleanup();
            return;
        }
        try {
            for (const [key, value] of opacities(layer)) {
                map.setPaintProperty(layer.id, key, value);
            }
        } catch {
            cleanup();
            return;
        }
        afterDraw(next);
    };

    const start = () => {
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
            for (const layer of layers) {
                const hidden = Object.fromEntries(
                    opacities(layer).map(([key]) => [key, 0]),
                );
                map.addLayer({
                    ...layer,
                    paint: {
                        ...("paint" in layer ? layer.paint : {}),
                        ...hidden,
                    },
                } as LayerSpecification);
                added.push(layer.id);
            }
        } catch {
            cleanup();
            return;
        }
        // Layers draw once the source's tile is parsed
        onRender = () => {
            let loaded = true;
            try {
                loaded = map.isSourceLoaded(SOURCE);
            } catch {
                /* Treat as loaded: the next step bails out if it is gone */
            }
            if (!loaded) return;
            if (onRender) map.off("render", onRender);
            onRender = null;
            if (!done) idle(next);
        };
        map.on("render", onRender);
        map.triggerRepaint();
        // Never leave them behind
        timer = setTimeout(cleanup, 10_000);
    };

    idle(start);
    return () => {
        if (handle !== null) {
            if (typeof cancelIdleCallback === "function") {
                cancelIdleCallback(handle);
            } else clearTimeout(handle);
        }
        cleanup();
    };
}
