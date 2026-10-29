import type { Locator, Page } from "@playwright/test";
import {
    boardRegion,
    expect,
    openHome,
    openSearch,
    STATIONS,
    settle,
    t,
    test,
    trainRegion,
} from "./support/test";

/** The search, focused and empty (the late trains show under it) */
async function openEmptySearch(page: Page) {
    await openHome(page);
    const field = await openSearch(page);
    await field.click();
    // The phone's sheet rises to full: tap its rows once it is there
    await settle(page, [field]);
    return field;
}

const lateSection = (page: Page) =>
    page.getByRole("region", { name: t.Search.late_now });

const allTrainsSection = (page: Page) =>
    page.getByRole("region", { name: t.Search.all_trains });

/** Train numbers of the rows in a train list, in order */
async function rowNumbers(list: Locator): Promise<string[]> {
    const rows = list.locator("button[title]:has(.tnum)");
    const texts = await rows.evaluateAll((buttons) =>
        buttons.map((b) => b.querySelector(".tnum")?.textContent?.trim() ?? ""),
    );
    return texts;
}

test("F27: an empty search lists the trains running late now", async ({
    page,
}) => {
    await openEmptySearch(page);
    const late = lateSection(page);
    await expect(late).toBeVisible();
    // 8 RUTHENIA (+45) before 9 TRANSCARPATHIA (+8); nothing on time
    await expect.poll(() => rowNumbers(late)).toEqual(["8", "9"]);
    await expect(late.locator("button[title]").first()).toContainText("+45");
});

test("F28: every train, sortable by delay, number and speed", async ({
    page,
}) => {
    await openEmptySearch(page);
    await lateSection(page)
        .getByRole("button", { name: new RegExp(t.Search.all_trains) })
        .click();
    const list = allTrainsSection(page);
    await expect(list).toBeVisible();

    // Latest first; trains without a live delay last, by number
    await expect
        .poll(() => rowNumbers(list))
        .toEqual(["8", "9", "6009", "2909", "38319", "2619", "6020", "H8000"]);

    const sort = (name: string) =>
        list.getByRole("button", { name: new RegExp(`^${name}`) });

    await sort(t.Search.sort_number).click();
    await expect
        .poll(() => rowNumbers(list))
        .toEqual(["8", "9", "2619", "2909", "6009", "6020", "38319", "H8000"]);
    // A second tap flips the direction
    await sort(t.Search.sort_number).click();
    await expect.poll(async () => (await rowNumbers(list))[0]).toBe("H8000");
    await expect(sort(t.Search.sort_number)).toHaveAccessibleName(
        new RegExp(t.Search.descending),
    );

    // F29: fastest first, with the speed in the row
    await sort(t.Search.sort_speed).click();
    await expect
        .poll(async () => (await rowNumbers(list)).slice(0, 2))
        .toEqual(["8", "6009"]);
    await expect(
        list.locator("button[title]:has(.tnum)").first(),
    ).toContainText("94 km/h");

    // Rows open their train
    await list.locator("button[title]:has(.tnum)").first().click();
    await expect(trainRegion(page)).toContainText("Chop");
});

test("D48: a train result reads number → destination", async ({ page }) => {
    await openHome(page);
    const field = await openSearch(page);
    await field.fill("6009");
    const option = page.getByRole("option").filter({ hasText: "6009" });
    await expect(option).toHaveCount(1);
    await expect(option).toContainText("Budapest-Nyugati");
    await expect(option).toHaveAttribute(
        "title",
        t.Search.train_to
            .replace("{train}", "6009")
            .replace("{destination}", "Budapest-Nyugati"),
    );
});

test("L17: 'Bud' ranks the Budapest stations first", async ({ page }) => {
    await openHome(page);
    const field = await openSearch(page);
    await field.fill("Bud");
    const stations = page.getByRole("option", {
        name: new RegExp(t.Search.station_label.replace("{station}", ".+")),
    });
    await expect(stations.first()).toBeVisible();
    const names = await stations.allTextContents();
    expect(names.slice(0, 4)).toEqual([
        "Budapest-Keleti",
        "Budapest-Nyugati",
        "Budapest-Kelenföld",
        "Budapest-Déli",
    ]);
});

test("D47: a board row says 'usually late' before departure", async ({
    page,
}) => {
    await openHome(page, `?station=${STATIONS.szolnok.id}`);
    const board = boardRegion(page, STATIONS.szolnok.name);
    const row = (number: string) =>
        board
            .getByRole("listitem")
            .filter({ has: page.getByText(number, { exact: true }) });
    await expect(row("3329")).toContainText(t.Station.usually_late);
    // Too few runs to say
    await expect(row("3339")).not.toContainText(t.Station.usually_late);
    // Never on a train already on its way
    await expect(row("9")).not.toContainText(t.Station.usually_late);
});

test("board rows show the delay the map shows", async ({ page }) => {
    await openHome(page, `?station=${STATIONS.szolnok.id}`);
    const board = boardRegion(page, STATIONS.szolnok.name);
    // 6020's position is old: a grey "+3?", as on its marker
    const stale = board.getByRole("listitem").filter({ hasText: "6020" });
    await expect(stale).toContainText("+3?");
    // A cancelled row says so, without a delay
    const cancelled = board
        .getByRole("listitem")
        .filter({ has: page.getByText("5719", { exact: true }) });
    await expect(cancelled).toContainText(t.Station.canceled);
    await expect(cancelled).not.toContainText(t.Delay.on_time);
});
