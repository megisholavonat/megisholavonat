import type { Page } from "@playwright/test";
import { expect, openHome, STATIONS, t, test } from "./support/test";

async function pick(page: Page, field: string, query: string, name: string) {
    const input = page.getByRole("searchbox", { name: field });
    const button = page.getByRole("button", { name: field, exact: true });
    // The first empty field opens in edit mode. The planner loads on
    // demand, so wait for either before choosing
    await expect(input.or(button).first()).toBeVisible();
    if (!(await input.isVisible())) await button.click();
    await input.fill(query);
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
        page.getByRole("button", { name: `${field}: ${name}` }),
    ).toBeVisible();
}

test("the planner shows transfer risk levels", async ({ page }) => {
    await openHome(page);
    await page.getByRole("button", { name: t.Journey.open }).click();
    await pick(page, t.Journey.from, "Szoln", STATIONS.szolnok.name);
    await pick(page, t.Journey.to, "Eger", STATIONS.eger.name);

    // Risky journeys carry their worst transfer in the list
    await expect(page.getByText(t.Journey.risk_tight).first()).toBeVisible();
    await expect(
        page.getByText(t.Journey.risk_likely_missed).first(),
    ).toBeVisible();

    // A safe one shows its changes, and the risk in its details
    const safe = page
        .getByRole("button")
        .filter({ hasText: t.Journey.changes.replace("{count}", "1") })
        .first();
    await safe.click();
    await expect(page.getByText(t.Journey.risk_safe).first()).toBeVisible();
});

async function openPlanner(page: Page) {
    await openHome(page);
    await page.getByRole("button", { name: t.Journey.open }).click();
}

const fill = (text: string, values: Record<string, string>) =>
    Object.entries(values).reduce(
        (out, [key, value]) => out.replace(`{${key}}`, value),
        text,
    );

test("city legs show as line badges, with the station the train leaves from", async ({
    page,
}) => {
    await openPlanner(page);
    const plan = page.waitForRequest((r) => r.url().includes("/v1/journeys"));
    await pick(page, t.Journey.from, "Keleti", STATIONS.keleti.name);
    await pick(page, t.Journey.to, "Szeged", STATIONS.szeged.name);
    // City transit is asked for
    expect(new URL((await plan).url()).searchParams.get("cityTransit")).toBe(
        "true",
    );

    // Bus 8E to Zugló, then the InterCity from there
    const card = page
        .getByRole("button", { expanded: false })
        .filter({ has: page.getByTestId("leg-chain") })
        .first();
    await expect(
        card.getByRole("img", { name: `${t.Journey.city_bus} 8E` }),
    ).toBeVisible();
    await expect(card.getByText("712", { exact: true })).toBeVisible();
    await expect(
        card.getByText(fill(t.Journey.from_station, { station: "Zugló" })),
    ).toBeVisible();

    // The details list the bus ride, and the ticket covers the train only
    await card.click();
    const ride = page.getByTestId("city-leg").first();
    await expect(ride).toContainText("Budapest, Keleti pályaudvar M");
    await expect(ride).toContainText("Budapest, Zugló vasútállomás");
    await expect(page.getByText(t.Journey.city_ticket)).toBeVisible();
});

test("Budapest (any station) plans from the best station and is shareable", async ({
    page,
}) => {
    await openPlanner(page);
    const input = page.getByRole("searchbox", { name: t.Journey.from });
    await input.fill("Budapest");
    // First, above the stations themselves
    const options = page.getByRole("button", { name: /Budapest/ });
    await expect(options.first()).toHaveText(t.Journey.any_budapest);
    const plan = page.waitForRequest((r) => r.url().includes("/v1/journeys"));
    await options.first().click();
    await pick(page, t.Journey.to, "Győr", STATIONS.gyor.name);
    expect(new URL((await plan).url()).searchParams.get("from")).toBe(
        "budapest",
    );

    // Every journey says which station its train leaves from
    await expect(
        page
            .getByText(
                fill(t.Journey.from_station, { station: "Budapest-Kelenföld" }),
            )
            .first(),
    ).toBeVisible();
    await expect(page).toHaveURL(/from=budapest&to=005501289/);

    // The link reopens the planner on the same journey
    await page.goto(new URL(page.url()).pathname + new URL(page.url()).search);
    await expect(
        page.getByRole("button", {
            name: `${t.Journey.from}: ${t.Journey.any_budapest}`,
        }),
    ).toBeVisible();
    await expect(
        page
            .getByText(
                fill(t.Journey.from_station, { station: "Budapest-Kelenföld" }),
            )
            .first(),
    ).toBeVisible();
});

test("the tram-train stop in front of Szeged station is not offered twice", async ({
    page,
}) => {
    await openPlanner(page);
    await page.getByRole("searchbox", { name: t.Journey.from }).fill("Szeged");
    await expect(
        page.getByRole("button", { name: "Szeged", exact: true }),
    ).toBeVisible();
    await expect(
        page.getByRole("button", { name: "Szeged vasútállomás" }),
    ).toHaveCount(0);
});

test("on a 360 px phone the risk badge never covers the trains", async ({
    page,
    isPhone,
}) => {
    test.skip(!isPhone, "phones only");
    await page.setViewportSize({ width: 360, height: 740 });
    await openPlanner(page);
    await pick(page, t.Journey.from, "Szoln", STATIONS.szolnok.name);
    await pick(page, t.Journey.to, "Eger", STATIONS.eger.name);

    const card = page
        .getByRole("button")
        .filter({ hasText: t.Journey.risk_likely_missed })
        .first();
    const chain = card.getByTestId("leg-chain");
    const badge = card.getByText(t.Journey.risk_likely_missed);
    await expect(badge).toBeVisible();
    const chainBox = await chain.boundingBox();
    const badgeBox = await badge.boundingBox();
    if (!chainBox || !badgeBox) throw new Error("not laid out");
    // Side by side, and every train number fully inside the chain
    expect(chainBox.x + chainBox.width).toBeLessThanOrEqual(badgeBox.x);
    for (const number of await chain.locator(".tnum").all()) {
        const box = await number.boundingBox();
        if (!box) throw new Error("not laid out");
        expect(box.x + box.width).toBeLessThanOrEqual(
            chainBox.x + chainBox.width + 0.5,
        );
    }
});
