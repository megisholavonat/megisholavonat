import type { Locator, Page } from "@playwright/test";
import {
    boardRegion,
    expect,
    knownGap,
    openHome,
    openSearch,
    openTrain,
    STATIONS,
    t,
    test,
    trainRegion,
} from "./support/test";

type Box = { x: number; y: number; width: number; height: number };

/** Overlap area of two boxes, in px² */
function overlap(a: Box, b: Box): number {
    const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return w > 0.5 && h > 0.5 ? w * h : 0;
}

/**
 * Asserts that the named elements are on screen, are not covered by anything
 * else at their centre, and do not overlap one another.
 */
async function expectNoOverlap(page: Page, items: Record<string, Locator>) {
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("no viewport");
    // Let sheets and controls finish moving
    await expect
        .poll(() =>
            page.evaluate(
                () =>
                    document
                        .getAnimations()
                        .filter(
                            (a) =>
                                a.playState === "running" &&
                                a.effect?.getTiming().iterations !== Infinity,
                        ).length,
            ),
        )
        .toBe(0);
    const boxes: [string, Box][] = [];
    const problems: string[] = [];
    for (const [name, locator] of Object.entries(items)) {
        await expect(locator, `${name} is visible`).toBeVisible();
        const box = await locator.boundingBox();
        if (!box) throw new Error(`${name} has no box`);
        boxes.push([name, box]);
        if (
            box.x < -0.5 ||
            box.y < -0.5 ||
            box.x + box.width > viewport.width + 0.5 ||
            box.y + box.height > viewport.height + 0.5
        ) {
            problems.push(`${name} is partly off screen`);
        }
        const onTop = await locator.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(
                r.x + r.width / 2,
                r.y + r.height / 2,
            );
            return !!hit && (el.contains(hit) || hit.contains(el));
        });
        if (!onTop) problems.push(`${name} is covered at its centre`);
    }
    for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
            const [a, boxA] = boxes[i];
            const [b, boxB] = boxes[j];
            if (overlap(boxA, boxB) > 0) problems.push(`${a} overlaps ${b}`);
        }
    }
    expect(problems).toEqual([]);
}

/** The map's attribution (the basemap's OpenStreetMap credit) */
const attribution = (page: Page) =>
    page
        .getByRole("group")
        .filter({ has: page.getByRole("link", { name: /OpenStreetMap/ }) })
        .first();

const consentCard = (page: Page) =>
    page.getByRole("region", { name: t.Consent.title });

const promptConsent = (page: Page) =>
    page.addInitScript(() => {
        localStorage.removeItem("mhav.consent.analytics");
        sessionStorage.setItem("mhav.consent.prompt", "1");
    });

/** The floating map controls of each layout */
function controls(page: Page, isPhone: boolean): Record<string, Locator> {
    const button = (name: string) => page.getByRole("button", { name });
    const common = {
        locate: button(t.Map.locate),
        settings: button(t.Settings.title),
    };
    if (isPhone) {
        return { ...common, legend: button(t.Legend.label) };
    }
    return {
        ...common,
        legend: page.getByRole("img", { name: t.Legend.label }),
        zoomIn: button(t.Map.zoom_in),
        zoomOut: button(t.Map.zoom_out),
        layers: button(t.Settings.layers),
    };
}

/** The home sheet (phone) or the search card (desktop) */
function homePanel(page: Page, isPhone: boolean): Locator {
    return isPhone
        ? page.getByRole("region", { name: t.Home.app_title })
        : page.getByRole("combobox", { name: t.Search.placeholder });
}

test("idle: controls, search and sheet do not overlap", async ({
    page,
    isPhone,
}) => {
    await openHome(page);
    await expectNoOverlap(page, {
        ...controls(page, isPhone),
        panel: homePanel(page, isPhone),
    });
});

test("D34: the map attribution stays visible", async ({ page, isPhone }) => {
    knownGap("D34: the attribution sits under the peek sheet", isPhone);
    await openHome(page);
    await expectNoOverlap(page, {
        ...controls(page, isPhone),
        panel: homePanel(page, isPhone),
        attribution: attribution(page),
    });
});

test("L1: the consent card leaves the controls usable", async ({
    page,
    isPhone,
}) => {
    knownGap("L1: the consent card covers the legend and locate", isPhone);
    await promptConsent(page);
    await openHome(page);
    await expectNoOverlap(page, {
        ...controls(page, isPhone),
        panel: homePanel(page, isPhone),
        consent: consentCard(page),
    });
});

test("L2: the consent card does not cover an open train", async ({
    page,
    isPhone,
}) => {
    knownGap("L2: the consent card sits on the train panel", !isPhone);
    await promptConsent(page);
    await openTrain(page, "delayed", "full");
    const items: Record<string, Locator> = { train: trainRegion(page) };
    // The phone hides the card while a sheet is full
    if (await consentCard(page).isVisible()) {
        items.consent = consentCard(page);
    }
    await expectNoOverlap(page, items);
});

test("an open train leaves the map controls usable", async ({
    page,
    isPhone,
}) => {
    await openTrain(page, "delayed", "half");
    const {
        settings: _settings,
        legend: _legend,
        ...rest
    } = controls(page, isPhone);
    await expectNoOverlap(page, { ...rest, train: trainRegion(page) });
});

test("L3: the consent card stays out of the search", async ({ page }) => {
    await promptConsent(page);
    await openHome(page);
    const field = await openSearch(page);
    await field.fill("Bud");
    const results = page.getByRole("listbox", { name: t.Search.results });
    await expect(results.getByRole("option").nth(5)).toBeVisible();
    const items: Record<string, Locator> = { search: field, results };
    // Hiding the card while searching is fine too
    if (await consentCard(page).isVisible()) {
        items.consent = consentCard(page);
    }
    await expectNoOverlap(page, items);
});

test("L5: the peek title keeps the destination on a 360 px phone", async ({
    page,
    isPhone,
}) => {
    test.skip(!isPhone, "phones only");
    await page.setViewportSize({ width: 360, height: 740 });
    const region = await openTrain(page, "late", "peek");
    const destination = region
        .getByText("Budapest-Keleti", { exact: true })
        .first();
    await expect(destination).toBeVisible();
    const clipped = await destination.evaluate(
        (el) => el.scrollWidth > el.clientWidth + 1,
    );
    expect(clipped).toBe(false);
});

test("L6: the full sheet keeps follow, share and ticket in view", async ({
    page,
}) => {
    const region = await openTrain(page, "delayed", "full");
    const height = page.viewportSize()?.height ?? 0;
    for (const action of [
        region.getByRole("button", { name: t.Follow.follow }),
        region.getByRole("button", { name: t.Train.share }),
        region.getByRole("link", { name: t.Train.ticket }),
    ]) {
        await expect(action).toBeVisible();
        const box = await action.boundingBox();
        expect((box?.y ?? height) + (box?.height ?? 0)).toBeLessThanOrEqual(
            height,
        );
    }
});

test("L9: the board panel leaves room for the map at 768 px", async ({
    page,
    isPhone,
}) => {
    test.skip(isPhone, "the phone board is a sheet");
    await page.setViewportSize({ width: 768, height: 1024 });
    await openHome(page, `?station=${STATIONS.szolnok.id}`);
    const panel = boardRegion(page, STATIONS.szolnok.name);
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(768 - ((box?.x ?? 0) + (box?.width ?? 0))).toBeGreaterThan(300);
});

test("L10: search and settings stay reachable beside an open panel", async ({
    page,
    isPhone,
}) => {
    test.skip(isPhone, "the phone shows a sheet");
    await openTrain(page, "delayed");
    await expectNoOverlap(page, {
        train: trainRegion(page),
        search: page.getByRole("combobox", { name: t.Search.placeholder }),
        settings: page.getByRole("button", { name: t.Settings.title }),
    });
});
