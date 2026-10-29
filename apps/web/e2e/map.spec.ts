import type { Page } from "@playwright/test";
import { expect, openTrain, t, test } from "./support/test";

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

/**
 * The map's layer ids, bottom to top. MapLibre is reached through React's
 * fiber tree: the app keeps no global handle on it.
 */
function layerIds(page: Page): Promise<string[] | null> {
    return page.evaluate(() => {
        type MapLike = {
            getStyle(): { layers?: { id: string }[] } | undefined;
        };
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
        return (map as MapLike).getStyle()?.layers?.map((l) => l.id) ?? null;
    });
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
