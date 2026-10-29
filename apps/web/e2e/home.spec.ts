import {
    boardRegion,
    expect,
    openHome,
    openSearch,
    STATIONS,
    t,
    test,
    trainRegion,
} from "./support/test";

test("home renders the map, search and controls", async ({ page }) => {
    await openHome(page);
    await expect(page.getByRole("region", { name: "Map" })).toBeVisible();
    await expect(
        page.getByRole("button", { name: t.Map.locate }),
    ).toBeVisible();
    await expect(
        page.getByRole("button", { name: t.Settings.title }),
    ).toBeVisible();
    await expect(
        page.getByRole("button", { name: t.Journey.open }),
    ).toBeVisible();
    await expect(
        page
            .getByRole("combobox", { name: t.Search.placeholder })
            .or(page.getByRole("button", { name: t.Search.placeholder })),
    ).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(
        0,
    );
});

test("search finds a station and opens its board", async ({ page }) => {
    await openHome(page);
    const field = await openSearch(page);
    await field.fill("Szoln");
    const option = page.getByRole("option", {
        name: t.Search.station_label.replace("{station}", "Szolnok"),
        exact: true,
    });
    await expect(option).toBeVisible();
    await option.click();
    await expect(boardRegion(page, STATIONS.szolnok.name)).toBeVisible();
});

test("search finds a train and opens it", async ({ page }) => {
    await openHome(page);
    const field = await openSearch(page);
    await field.fill("2909");
    const option = page.getByRole("option").filter({ hasText: "2909" });
    await expect(option).toHaveCount(1);
    await option.click();
    const region = trainRegion(page);
    await expect(region).toBeVisible();
    await expect(region).toContainText("2909");
});

test("P5: phone search keeps the map in view", async ({ page, isPhone }) => {
    test.skip(!isPhone, "the desktop search is a card beside the map");
    await openHome(page);
    const field = await openSearch(page);
    await field.fill("Szoln");
    await expect(page.getByRole("option").first()).toBeVisible();
    // The map still shows above the search
    const mapShows = await page
        .getByRole("region", { name: "Map" })
        .evaluate((map) => {
            const hit = document.elementFromPoint(window.innerWidth / 2, 60);
            return !!hit && map.contains(hit);
        });
    expect(mapShows).toBe(true);
});

test("settings open and close", async ({ page }) => {
    await openHome(page);
    await page.getByRole("button", { name: t.Settings.title }).click();
    const dialog = page.getByRole("dialog", { name: t.Settings.title });
    await expect(dialog).toBeVisible();
    await expect(
        dialog.getByRole("switch", { name: t.AnalyticsConsentSwitch.label }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: t.Settings.close }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: t.Settings.title }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
});

test("stats page renders rankings and the hourly chart", async ({ page }) => {
    await page.goto("/stats");
    await expect(
        page.getByRole("heading", { name: t.Stats.title, level: 1 }),
    ).toBeVisible();
    await expect(
        page.getByRole("tablist", { name: t.Stats.rankings }),
    ).toBeVisible();
    await expect(page.getByRole("listitem").first()).toBeVisible();
    await expect(
        page.getByRole("heading", { name: t.Stats.all_trains }),
    ).toBeVisible();
    await page.getByRole("tab", { name: t.Stats.stations }).click();
    await expect(page).toHaveURL(/kind=stations/);
    await expect(page.getByRole("listitem").first()).toBeVisible();
});
