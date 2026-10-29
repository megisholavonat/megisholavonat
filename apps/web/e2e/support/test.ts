import { test as base, expect, type Locator, type Page } from "@playwright/test";
import hu from "../../messages/hu.json";
import {
    type CapturedEvent,
    mockApi,
    NOW,
    TRAINS,
    type TrainRole,
} from "./api";

export { STATIONS, TRAINS } from "./api";
export { expect };

/** The Hungarian UI strings, so tests follow copy changes */
export const t = hu;

type Options = {
    /** Analytics consent stored before the first load ("pending": none) */
    consent: "granted" | "denied" | "pending";
};

type Fixtures = {
    analytics: string[];
    /** Events PostHog sent (decoded) */
    events: CapturedEvent[];
    isPhone: boolean;
};

const capturedEvents = new WeakMap<Page, CapturedEvent[]>();

export const test = base.extend<Options & Fixtures>({
    consent: ["denied", { option: true }],
    analytics: [
        async ({ page, baseURL, consent }, use) => {
            await page.clock.setFixedTime(NOW);
            if (consent !== "pending") {
                // Only when nothing is stored, so a choice made in the test
                // survives reloads
                await page.addInitScript(
                    ({ value, date }) => {
                        const key = "mhav.consent.analytics";
                        if (!localStorage.getItem(key)) {
                            localStorage.setItem(
                                key,
                                JSON.stringify({ value, version: 1, date }),
                            );
                        }
                    },
                    { value: consent, date: NOW.toISOString() },
                );
            }
            const mock = await mockApi(page, baseURL ?? "");
            capturedEvents.set(page, mock.events);
            await use(mock.analytics);
        },
        { auto: true },
    ],
    events: async ({ page, analytics }, use) => {
        void analytics;
        await use(capturedEvents.get(page) ?? []);
    },
    isPhone: async ({ viewport }, use) => {
        await use((viewport?.width ?? 0) < 768);
    },
});

/**
 * Marks a test as a known gap from the audit (`test.fixme`), so the suite
 * stays green until the fix lands. `E2E_RUN_FIXME=1` runs them anyway, to
 * see which ones a branch fixes.
 */
export function knownGap(description: string, condition = true) {
    test.fixme(condition && !process.env.E2E_RUN_FIXME, description);
}

type Box = { x: number; y: number; width: number; height: number };

/** Finite animations still running: sheet glides, fades, CSS transitions */
const runningAnimations = (page: Page) =>
    page.evaluate(
        () =>
            document
                .getAnimations()
                .filter(
                    (a) =>
                        a.playState === "running" &&
                        a.effect?.getTiming().iterations !== Infinity,
                ).length,
    );

/**
 * Waits until the layout has come to rest: no finite animation runs and
 * the elements keep the same boxes from one check to the next. A single
 * "no animations" check passes too early, before a sheet that is about to
 * move has started to, or while data still reflows it. Returns the boxes.
 */
export async function settle(page: Page, locators: Locator[]): Promise<Box[]> {
    let previous: string | null = null;
    let boxes: Box[] = [];
    await expect
        .poll(
            async () => {
                const idle = (await runningAnimations(page)) === 0;
                const now: Box[] = [];
                for (const locator of locators) {
                    const box = await locator.boundingBox();
                    if (!box) {
                        previous = null;
                        return false;
                    }
                    now.push(box);
                }
                const key = JSON.stringify(now);
                const still = idle && key === previous;
                previous = idle ? key : null;
                boxes = now;
                return still && (await runningAnimations(page)) === 0;
            },
            { message: "the layout comes to rest" },
        )
        .toBe(true);
    return boxes;
}

/** Opens the map */
export async function openHome(page: Page, query = "") {
    await page.goto(`/${query}`);
    await expect(
        page.getByRole("heading", { name: t.Home.app_title }).first(),
    ).toBeAttached();
}

/** The train sheet (phone) or panel (desktop) */
export const trainRegion = (page: Page) =>
    page.getByRole("region", { name: t.Train.sheet_label, exact: true });

/** The station board sheet or panel */
export const boardRegion = (page: Page, station: string) =>
    page.getByRole("region", {
        name: t.Station.board_of.replace("{station}", station),
    });

/**
 * Opens a train from a shared link. On the phone the sheet opens at peek;
 * `detent` steps it up with the sheet's resize handle.
 */
export async function openTrain(
    page: Page,
    role: TrainRole,
    detent: "peek" | "half" | "full" = "half",
) {
    await openHome(page, `?vehicleId=${encodeURIComponent(TRAINS[role].id)}`);
    const region = trainRegion(page);
    await expect(region).toBeVisible();
    const handle = region.getByRole("button", { name: t.Sheet.resize });
    if (await handle.isVisible()) {
        const steps = { peek: 0, half: 1, full: 2 }[detent];
        for (let i = 0; i < steps; i++) await handle.click();
    }
    // At its detent, not still gliding there
    await settle(page, [region]);
    return region;
}

/** The search field, opening the phone's search first */
export async function openSearch(page: Page) {
    const field = page.getByRole("combobox", { name: t.Search.placeholder });
    if (!(await field.isVisible())) {
        await page
            .getByRole("button", { name: t.Search.placeholder })
            .first()
            .click();
    }
    await expect(field).toBeVisible();
    return field;
}

/** A signed delay as the tile shows it: "+45", "0", "−1", optionally "?" */
export const DELAY_NUMBER = /^\s*(?:[+−-]\s?\d+|0|±\s?0)\s*\??\s*$/;
