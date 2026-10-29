import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
    boardRegion,
    expect,
    openHome,
    openTrain,
    STATIONS,
    t,
    test,
    trainRegion,
} from "./support/test";

/**
 * Captured from /v1/alerts/disruptions on 2026-10-29 at 03:55: the
 * Mándok–Tornyospálca replacement bus (three alerts merged) and the H8/H9
 * engineering works.
 */
type Disruption = {
    id: string;
    stations: { id: string; name: string }[];
    trips: { tripId: string; tripShortName: string }[];
};
const DISRUPTIONS: Disruption[] = JSON.parse(
    readFileSync(join(__dirname, "fixtures", "disruptions.json"), "utf8"),
);
const MANDOK = "Pótlóbusz Mándok és Tornyospálca között";
const HEV = "Pótlóbusz Örs vezér tere és Cinkota között";
/** Trip of the H5 train in train-hev.json */
const HEV_TRIP = "1:36381329";

const d = t.Disruptions;
const chipName = new RegExp(d.chip.replace("{count}", "2"));

async function serve(page: Page, list: Disruption[] = DISRUPTIONS) {
    // Added after the shared mock, so it wins
    await page.route(/\/api\/v1\/alerts\/disruptions/, (route) =>
        route.fulfill({
            contentType: "application/json",
            body: JSON.stringify(list),
        }),
    );
}

const listRegion = (page: Page) =>
    page.getByRole("region", { name: d.title, exact: true });

test("no chip without disruptions", async ({ page }) => {
    await openHome(page);
    await expect(
        page.getByRole("button", { name: /forgalmi zavar/ }),
    ).toHaveCount(0);
});

test("the home chip opens the list; an item expands to MÁV's text", async ({
    page,
}) => {
    await serve(page);
    await openHome(page);
    const chip = page.getByRole("button", { name: chipName });
    await expect(chip).toBeVisible();
    await chip.click();

    const list = listRegion(page);
    await expect(list).toBeVisible();
    const items = list.getByRole("article");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText(MANDOK);
    await expect(items.nth(1)).toContainText(HEV);
    await expect(items.nth(1)).toContainText(d.cause_engineering);

    const toggle = items.nth(0).getByRole("button", { expanded: false });
    await toggle.click();
    await expect(
        items.nth(0).getByRole("button", { expanded: true }),
    ).toBeVisible();
    await expect(items.nth(0)).toContainText(
        "a vasúti közlekedés nem lehetséges",
    );
    await expect(
        items.nth(0).getByRole("link", { name: d.source_mavinform }),
    ).toHaveAttribute("href", "https://www.mavcsoport.hu/mavinform");
});

test("a followed train's disruption comes first", async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem(
            "mhav.follows",
            JSON.stringify([
                {
                    id: "e2e",
                    trainNumber: "H1524",
                    routeShortName: "H8",
                    destination: "Gödöllő",
                    fromStationId: "003619795",
                    fromName: "Örs vezér tere H",
                    fromLat: 47.5,
                    fromLon: 19.14,
                    departureS: 8 * 3600,
                    weekdays: [1, 2, 3, 4, 5, 6, 7],
                    date: null,
                    createdAt: 1,
                },
            ]),
        );
    });
    await serve(page);
    await openHome(page);
    const chip = page.getByRole("button", { name: chipName });
    await expect(chip).toContainText(d.chip_mine.replace("{count}", "1"));
    await chip.click();

    const first = listRegion(page).getByRole("article").first();
    await expect(first).toContainText(HEV);
    await expect(first).toContainText(d.mine);
});

test("the train sheet shows a disruption on its trip", async ({ page }) => {
    await serve(
        page,
        DISRUPTIONS.map((x, i) =>
            i === 1
                ? {
                      ...x,
                      trips: [
                          ...x.trips,
                          { tripId: HEV_TRIP, tripShortName: "H5 HÉV" },
                      ],
                  }
                : x,
        ),
    );
    const region = await openTrain(page, "hev");
    await expect(region.getByRole("article")).toContainText(HEV);
    await expect(region).not.toContainText(MANDOK);
});

test("an unaffected train has no disruption", async ({ page }) => {
    await serve(page);
    const region = await openTrain(page, "ontime");
    await expect(region).toContainText("2909");
    await expect(trainRegion(page).getByRole("article")).toHaveCount(0);
});

test("the station board shows a disruption naming the station", async ({
    page,
}) => {
    await serve(
        page,
        DISRUPTIONS.map((x, i) =>
            i === 0
                ? {
                      ...x,
                      stations: [
                          ...x.stations,
                          { id: STATIONS.szolnok.id, name: "Szolnok" },
                      ],
                  }
                : x,
        ),
    );
    await openHome(page, `?station=${STATIONS.szolnok.id}`);
    const board = boardRegion(page, STATIONS.szolnok.name);
    await expect(board.getByRole("article")).toContainText(MANDOK);
    await expect(board).not.toContainText(HEV);
});
