import type { Page } from "@playwright/test";
import {
    boardRegion,
    expect,
    openHome,
    openSearch,
    STATIONS,
    TRAINS,
    t,
    test,
    trainRegion,
} from "./support/test";

const param = (page: Page, name: string) =>
    new URL(page.url()).searchParams.get(name);

const board = (page: Page) => boardRegion(page, STATIONS.szolnok.name);

/** Home, then the Szolnok board from the search */
async function searchBoard(page: Page) {
    await openHome(page);
    const field = await openSearch(page);
    await field.fill("Szolnok");
    await page
        .getByRole("option")
        .filter({ hasText: STATIONS.szolnok.name })
        .first()
        .click();
    await expect(board(page)).toBeVisible();
    await expect.poll(() => param(page, "station")).toBe(STATIONS.szolnok.id);
}

/** A train from the open board */
async function boardTrain(page: Page) {
    await board(page)
        .getByRole("button", { name: /\b9\b/ })
        .filter({ hasText: "Budapest-Keleti" })
        .first()
        .click();
    await expect(trainRegion(page)).toBeVisible();
    await expect.poll(() => param(page, "vehicleId")).toBe(TRAINS.late.id);
    // The pointer stays where the row was, and may now hover one of the
    // train's hover tips: that tip would rightly take the next Esc
    const width = page.viewportSize()?.width ?? 390;
    await page.mouse.move(width - 100, 120);
}

test("M-1: back closes the train, then the board, and stays in the app", async ({
    page,
}) => {
    await searchBoard(page);
    await boardTrain(page);

    await page.goBack();
    await expect(trainRegion(page)).toBeHidden();
    await expect(board(page)).toBeVisible();
    expect(param(page, "vehicleId")).toBeNull();

    await page.goBack();
    await expect(board(page)).toBeHidden();
    expect(param(page, "station")).toBeNull();
    // Still on the map: search left no entry of its own
    await expect(
        page.getByRole("heading", { name: t.Home.app_title }).first(),
    ).toBeAttached();

    // Forward reopens the board
    await page.goForward();
    await expect(board(page)).toBeVisible();
});

test("M-1: closing a layer by hand pops its entry", async ({ page }) => {
    await searchBoard(page);
    await boardTrain(page);
    const length = await page.evaluate(() => history.length);
    await trainRegion(page)
        .getByRole("button", {
            name: new RegExp(`^(${t.Train.close}|${t.Train.back})$`),
        })
        .first()
        .click();
    await expect(trainRegion(page)).toBeHidden();
    await expect(board(page)).toBeVisible();
    await expect.poll(() => param(page, "vehicleId")).toBeNull();
    // Back from here goes under the board, not to the closed train
    await page.goBack();
    await expect(board(page)).toBeHidden();
    await expect(trainRegion(page)).toBeHidden();
    expect(await page.evaluate(() => history.length)).toBe(length);
});

test("M-1: phone back closes the search sheet", async ({ page, isPhone }) => {
    test.skip(!isPhone, "the desktop search is not a layer");
    await openHome(page);
    // The phone's field sits in the home sheet; a tap opens search
    await (await openSearch(page)).click();
    const sheet = page.getByRole("dialog", { name: t.Home.app_title });
    await expect(sheet).toBeVisible();
    await page.goBack();
    await expect(sheet).toBeHidden();
    await expect(
        page.getByRole("region", { name: t.Home.app_title }),
    ).toBeVisible();
});

test("M-1: a shared train link still opens, and reloads", async ({ page }) => {
    await openHome(page, `?vehicleId=${encodeURIComponent(TRAINS.late.id)}`);
    await expect(trainRegion(page)).toBeVisible();
    await page.reload();
    await expect(trainRegion(page)).toBeVisible();
    await expect.poll(() => param(page, "vehicleId")).toBe(TRAINS.late.id);
});

test("M-2: Esc closes settings, not the board under it", async ({ page }) => {
    await openHome(page, `?station=${STATIONS.szolnok.id}`);
    await expect(board(page)).toBeVisible();
    await page.getByRole("button", { name: t.Settings.title }).first().click();
    const dialog = page.getByRole("dialog", { name: t.Settings.title });
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(board(page)).toBeVisible();
    expect(param(page, "station")).toBe(STATIONS.szolnok.id);

    // The next Esc closes the board
    await page.keyboard.press("Escape");
    await expect(board(page)).toBeHidden();
});

test("M-2: Esc closes the train first, then the board", async ({ page }) => {
    await searchBoard(page);
    await boardTrain(page);
    await page.locator("body").press("Escape");
    await expect(trainRegion(page)).toBeHidden();
    await expect(board(page)).toBeVisible();
    await page.locator("body").press("Escape");
    await expect(board(page)).toBeHidden();
});

test("m-6: a link to an unknown station says so and clears it", async ({
    page,
}) => {
    await page.route(/\/api\/v1\/stations\/999\//, (route) =>
        route.fulfill({
            status: 404,
            contentType: "application/json",
            body: JSON.stringify({ detail: "Not Found" }),
        }),
    );
    await openHome(page, "?station=999");
    await expect(page.getByText(t.Shell.station_unknown)).toBeVisible();
    await expect.poll(() => param(page, "station")).toBeNull();
});

test("m-6: a link to a train that is gone says so", async ({ page }) => {
    await openHome(page, "?vehicleId=1%3Anot-running");
    await expect(page.getByText(t.Shell.train_gone)).toBeVisible();
    await expect.poll(() => param(page, "vehicleId")).toBeNull();
});
