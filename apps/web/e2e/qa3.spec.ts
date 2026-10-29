// Fixes from QA round 3 (web): board times, focus return, legend values,
// the selected station's own label, privacy share tags.
import {
    boardRegion,
    expect,
    openHome,
    STATIONS,
    TRAINS,
    t,
    test,
    trainRegion,
} from "./support/test";

const openBoard = async (page: Parameters<typeof openHome>[0]) => {
    await openHome(page, `?station=${STATIONS.szolnok.id}`);
    const board = boardRegion(page, STATIONS.szolnok.name);
    await expect(board).toBeVisible();
    return board;
};

/** The big time of each board row, in order */
const rowTimes = (board: ReturnType<typeof boardRegion>) =>
    board
        .locator("li .tnum.text-headline")
        .evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ""));

test("n-F: a late board row shows its expected time, in order", async ({
    page,
}) => {
    const board = await openBoard(page);
    // 9 TRANSCARPATHIA: due 04:06, running late
    const row = board
        .getByRole("button")
        .filter({ hasText: "Budapest-Keleti" });
    await expect(row.first()).toBeVisible();
    const late = row.filter({ has: page.locator("s") }).first();
    await expect(late.locator("s")).toContainText("04:06");
    await expect(late.locator(".tnum.text-headline")).not.toHaveText("04:06");
    // The times read in order, top to bottom
    const times = await rowTimes(board);
    expect(times.length).toBeGreaterThan(5);
    expect([...times].sort()).toEqual(times);
});

test("n-E: closing the train puts focus back on its board row", async ({
    page,
}) => {
    const board = await openBoard(page);
    const row = board
        .getByRole("button", { name: /\b9\b/ })
        .filter({ hasText: "Budapest-Keleti" })
        .first();
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(trainRegion(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trainRegion(page)).toBeHidden();
    await expect
        .poll(() =>
            page.evaluate(() =>
                document.activeElement?.getAttribute("data-focus-key"),
            ),
        )
        .toBe(`train:${TRAINS.late.id}`);
});

test("n-E: the close button returns focus too", async ({ page, isPhone }) => {
    const board = await openBoard(page);
    await board
        .getByRole("button", { name: /\b9\b/ })
        .filter({ hasText: "Budapest-Keleti" })
        .first()
        .click();
    const region = trainRegion(page);
    await expect(region).toBeVisible();
    await region
        .getByRole("button", { name: isPhone ? t.Sheet.close : t.Train.back })
        .first()
        .click();
    await expect(region).toBeHidden();
    await expect
        .poll(() =>
            page.evaluate(() =>
                document.activeElement?.getAttribute("data-focus-key"),
            ),
        )
        .toBe(`train:${TRAINS.late.id}`);
});

test("p-E: the phone legend gives each colour its minutes", async ({
    page,
    isPhone,
}) => {
    test.skip(!isPhone, "phone legend");
    await openHome(page);
    const legend = page.getByRole("button", { name: t.Legend.label });
    await expect(legend).toContainText(t.Legend.title);
    for (const step of ["0", "5", "15", "60+", t.Legend.minutes]) {
        await expect(legend).toContainText(step);
    }
    await legend.click();
    const list = page.getByRole("list", { name: t.Legend.label });
    // The stale marker's "7′" and the grey dot are explained
    await expect(list).toContainText("7′");
    await expect(list).toContainText(t.Legend.stale);
    await expect(list).toContainText(t.Legend.inactive);
});

test("p-A: the privacy page shares as itself", async ({ page }) => {
    await page.goto("/hu/privacy");
    const og = (property: string) =>
        page.locator(`meta[property="${property}"]`).getAttribute("content");
    expect(await og("og:title")).toContain(t.PrivacyPage.title);
    expect(await og("og:url")).toMatch(/\/hu\/privacy$/);
});
