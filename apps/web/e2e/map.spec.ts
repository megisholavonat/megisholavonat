import { MAP_PALETTE } from "@megisholavonat/core/tokens/map";
import type { Page } from "@playwright/test";
import { expect, openHome, openTrain, STATIONS, t, test } from "./support/test";

/** Console errors and uncaught exceptions, minus blocked network requests */
function collectErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        if (text.startsWith("Failed to load resource")) return;
        errors.push(text);
    });
    page.on("pageerror", (error) => errors.push(error.message));
    return errors;
}

/** The parts of a MapLibre map the tests read */
type MapLike = {
    getStyle(): { layers?: StyleLayer[] } | undefined;
    getPaintProperty(layer: string, name: string): unknown;
    jumpTo(options: { center: [number, number]; zoom: number }): void;
    getZoom(): number;
};
type StyleLayer = {
    id: string;
    minzoom?: number;
    maxzoom?: number;
    filter?: unknown;
    layout?: Record<string, unknown>;
    paint?: Record<string, unknown>;
};

/**
 * Runs `body` on the page's MapLibre map (null before there is one, or
 * while the page's map is being replaced).
 * MapLibre is reached through React's fiber tree: the app keeps no global
 * handle on it. `body` is sent as source, so it may use only its argument.
 */
function onMap<T>(page: Page, body: (map: MapLike) => T): Promise<T | null> {
    return page.evaluate((source) => {
        let map: MapLike | null = null;
        const seen = new Set<unknown>();
        const scan = (value: unknown, depth: number) => {
            if (!value || typeof value !== "object" || depth > 4) return;
            if (map || seen.has(value)) return;
            seen.add(value);
            const getMap = (value as { getMap?: () => MapLike }).getMap;
            if (typeof getMap === "function") {
                map = getMap.call(value);
                return;
            }
            for (const key of Object.keys(value)) {
                if (["_owner", "return", "child", "sibling"].includes(key)) {
                    continue;
                }
                try {
                    scan((value as Record<string, unknown>)[key], depth + 1);
                } catch {
                    /* getters that throw */
                }
            }
        };
        type Fiber = {
            return: Fiber | null;
            memoizedState: { memoizedState: unknown; next: unknown } | null;
        };
        let node: Element | null = document.querySelector(".maplibregl-map");
        for (; node && !map; node = node.parentElement) {
            const key = Object.keys(node).find((k) =>
                k.startsWith("__reactFiber"),
            );
            let fiber = key
                ? (node as unknown as Record<string, Fiber>)[key]
                : null;
            for (let i = 0; fiber && i < 40 && !map; i++) {
                let state = fiber.memoizedState;
                for (let j = 0; state && j < 50 && !map; j++) {
                    scan(state.memoizedState, 0);
                    state = state.next as typeof state;
                }
                fiber = fiber.return;
            }
        }
        if (!map) return null;
        try {
            return new Function("map", `return (${source})(map)`)(map);
        } catch {
            // The map of the page before, being removed
            return null;
        }
    }, body.toString());
}

/** The map's layer ids, bottom to top */
function layerIds(page: Page): Promise<string[] | null> {
    return onMap(page, (map) => map.getStyle()?.layers?.map((l) => l.id) ?? []);
}

/**
 * The selected train's route and stops are drawn, and everything the app
 * adds sits in its slot: network (and the opt-in overlay) under the place
 * names < our stations < route < stops < station < trains.
 */
async function expectLayerOrder(page: Page, overlay = false) {
    await expect
        .poll(async () => {
            const ids = await layerIds(page);
            if (!ids) return "no map yet";
            const at = (id: string) => ids.indexOf(id);
            const order = [
                "mhav-network",
                ...(overlay ? ["railway-layer"] : []),
                "slot-railway",
                "place-city",
                "mhav-station-dot-1",
                "mhav-station-label-1",
                "slot-route",
                "polyline-casing",
                "polyline-layer",
                "slot-stops",
                "stops-layer",
                "slot-station",
                "slot-trains",
                "marker-dot",
                "marker-sel-pill",
            ].map(at);
            return order.every(
                (index, i) =>
                    index >= 0 && (i === 0 || index > (order[i - 1] ?? -1)),
            )
                ? "ok"
                : JSON.stringify(order);
        })
        .toBe("ok");
}

async function switchTheme(page: Page, label: string) {
    await page.getByRole("button", { name: t.Settings.title }).first().click();
    const dialog = page.getByRole("dialog", { name: t.Settings.title });
    await dialog
        .getByRole("combobox", { name: t.Settings.theme })
        .selectOption({ label });
    await dialog.getByRole("button", { name: t.Settings.close }).click();
    await expect(dialog).toBeHidden();
}

test("BL-1: switching the theme keeps the route, stops and draw order", async ({
    page,
}) => {
    const errors = collectErrors(page);
    // The detailed railway map is opt-in: switched on, it stays in its slot
    await page.addInitScript(() =>
        localStorage.setItem("mhav.settings.showRailwayOverlay", "true"),
    );
    const region = await openTrain(page, "delayed", "peek");
    await expectLayerOrder(page, true);

    await switchTheme(page, t.Settings.theme_dark);
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expectLayerOrder(page, true);
    await switchTheme(page, t.Settings.theme_light);
    await expectLayerOrder(page, true);

    // The selection survives
    await expect(region).toBeVisible();
    expect(errors).toEqual([]);
});

test("BL-1: a system theme flip keeps the draw order", async ({ page }) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ colorScheme: "light" });
    await openTrain(page, "delayed", "peek");
    await expectLayerOrder(page);

    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expectLayerOrder(page);
    expect(errors).toEqual([]);
});

/** The basemap's land and a place name's colour, as the map draws them */
function basemapColours(page: Page) {
    return onMap(page, (map) => ({
        land: map.getPaintProperty("background", "background-color"),
        city: map.getPaintProperty("place-city", "text-color"),
    }));
}

test("switching the language keeps the dark map dark", async ({ page }) => {
    const errors = collectErrors(page);
    await page.addInitScript(() => {
        if (!sessionStorage.getItem("e2e.theme")) {
            sessionStorage.setItem("e2e.theme", "1");
            localStorage.setItem("theme", "dark");
        }
    });
    await openHome(page);
    await expect(page.locator("html")).toHaveClass(/dark/);
    const dark = {
        land: MAP_PALETTE.dark.land,
        city: MAP_PALETTE.dark.city,
    };
    await expect.poll(() => basemapColours(page)).toEqual(dark);

    await page.getByRole("button", { name: t.Settings.title }).first().click();
    await page
        .getByRole("dialog", { name: t.Settings.title })
        .getByRole("combobox", { name: t.Settings.language })
        .selectOption("en");
    await page.waitForURL(/\/en(\?|$)/);
    // The whole map follows: the basemap as well as our own layers
    await expect.poll(() => basemapColours(page)).toEqual(dark);
    await expect
        .poll(() =>
            onMap(page, (map) =>
                map.getPaintProperty("mhav-station-label-1", "text-color"),
            ),
        )
        .toBe(MAP_PALETTE.dark.stationLabel);
    expect(errors).toEqual([]);
});

/** Station names' layers and the trains' around them, at zoom 14 */
function stationNames(page: Page) {
    return onMap(page, (map) => {
        map.jumpTo({ center: [19.0835, 47.5005], zoom: 14 });
        const layers = map.getStyle()?.layers ?? [];
        const at = (id: string) => layers.findIndex((l) => l.id === id);
        const label = layers.find((l) => l.id === "mhav-station-label-1");
        const zoom = map.getZoom();
        const order = [
            at("marker-delay"),
            at("marker-dot-room"),
            at("mhav-station-label-1"),
            at("marker-dot"),
        ];
        return {
            shown:
                !!label &&
                (label.minzoom ?? 0) <= zoom &&
                zoom < (label.maxzoom ?? 24) &&
                label.layout?.visibility !== "none",
            maxzoom: label?.maxzoom ?? null,
            filter: JSON.stringify(label?.filter ?? null),
            // Placed after every unselected train (MapLibre places the top
            // layer first), drawn under them
            placedAfterTrains: order.every(
                (index, i) =>
                    index >= 0 && (i === 0 || index > (order[i - 1] ?? -1)),
            ),
            trainsPushNames:
                layers.find((l) => l.id === "marker-dot")?.layout?.[
                    "icon-ignore-placement"
                ] !== true,
        };
    });
}

test("station names stay at zoom 14, under the trains", async ({ page }) => {
    await openHome(page);
    await expect
        .poll(() => stationNames(page))
        .toEqual({
            shown: true,
            maxzoom: null,
            filter: expect.not.stringContaining("!="),
            placedAfterTrains: true,
            trainsPushNames: false,
        });
});

test("a station is never named twice", async ({ page }) => {
    // The selected station's box names it: its plain name steps aside
    await openHome(page, `?station=${STATIONS.szolnok.id}`);
    await expect
        .poll(async () => (await stationNames(page))?.filter)
        .toContain(STATIONS.szolnok.id);

    // The railway overlay writes its own names close in
    await page.addInitScript(() =>
        localStorage.setItem("mhav.settings.showRailwayOverlay", "true"),
    );
    await openHome(page);
    await expect
        .poll(async () => (await stationNames(page))?.maxzoom)
        .toBe(10.5);
});
