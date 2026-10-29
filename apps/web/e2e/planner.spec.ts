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

test("the time choice has no hidden fields and sets the query", async ({
    page,
}) => {
    await openHome(page);
    await page.getByRole("button", { name: t.Journey.open }).click();
    const planned = (check: (q: URLSearchParams) => boolean) =>
        page.waitForRequest((request) => {
            const url = new URL(request.url());
            return (
                url.pathname.endsWith("/v1/journeys") && check(url.searchParams)
            );
        });
    // Planning for now sends no time: the server takes its own clock
    const now = planned((q) => !q.has("time") && q.get("arriveBy") === "false");
    await pick(page, t.Journey.from, "Szoln", STATIONS.szolnok.name);
    await pick(page, t.Journey.to, "Eger", STATIONS.eger.name);
    await now;

    const group = page.getByRole("group", { name: t.Journey.time });
    const segment = (name: string) => group.locator("label", { hasText: name });
    const date = group.getByLabel(t.Journey.date);
    const clock = group.getByLabel(t.Journey.time_of_day);

    // "Now" is a plain choice: tapping it focuses no field, and there is
    // no field at all, visible or not
    await segment(t.Journey.now).click();
    await expect(
        group.getByRole("radio", { name: t.Journey.now }),
    ).toBeChecked();
    await expect(group.locator("input:not([type=radio])")).toHaveCount(0);
    const focused = await page.evaluate(
        () => (document.activeElement as HTMLInputElement | null)?.type ?? "",
    );
    expect(focused).not.toMatch(/date|time/);

    // A set time starts from the current one (the fixed clock: 03:00)
    let request = planned(
        (q) =>
            q.get("time") === "2026-10-29T03:00" &&
            q.get("arriveBy") === "false",
    );
    await segment(t.Journey.depart).click();
    await request;
    await expect(date).toBeVisible();
    await expect(date).toHaveValue("2026-10-29");
    await expect(clock).toBeVisible();
    await expect(clock).toHaveValue("03:00");

    request = planned((q) => q.get("time") === "2026-10-30T03:00");
    await date.fill("2026-10-30");
    await request;
    request = planned(
        (q) =>
            q.get("time") === "2026-10-30T08:15" &&
            q.get("arriveBy") === "false",
    );
    await clock.fill("08:15");
    await request;

    // Arrow keys move between the choices and keep the time
    request = planned(
        (q) =>
            q.get("time") === "2026-10-30T08:15" &&
            q.get("arriveBy") === "true",
    );
    await group.getByRole("radio", { name: t.Journey.depart }).focus();
    await page.keyboard.press("ArrowRight");
    await request;
    await expect(
        group.getByRole("radio", { name: t.Journey.arrive }),
    ).toBeChecked();

    // Back to now (its results are still fresh in the cache): the fields go
    await segment(t.Journey.now).click();
    await expect(
        group.getByRole("radio", { name: t.Journey.now }),
    ).toBeChecked();
    await expect(group.locator("input:not([type=radio])")).toHaveCount(0);
});

test("a shared link sets the time control, and the control writes the link", async ({
    page,
}) => {
    const planned = page.waitForRequest((request) => {
        const url = new URL(request.url());
        return (
            url.pathname.endsWith("/v1/journeys") &&
            url.searchParams.get("time") === "2026-10-30T08:15" &&
            url.searchParams.get("arriveBy") === "true"
        );
    });
    await openHome(
        page,
        `?from=${STATIONS.szolnok.id}&to=${STATIONS.eger.id}&time=2026-10-30T08:15&arriveBy=1`,
    );
    await planned;
    const group = page.getByRole("group", { name: t.Journey.time });
    await expect(
        group.getByRole("radio", { name: t.Journey.arrive }),
    ).toBeChecked();
    await expect(group.getByLabel(t.Journey.date)).toHaveValue("2026-10-30");
    await expect(group.getByLabel(t.Journey.time_of_day)).toHaveValue("08:15");

    // Changing it rewrites the link; "now" drops the time from it
    await group.getByLabel(t.Journey.time_of_day).fill("09:40");
    await expect(page).toHaveURL(/time=2026-10-30T09%3A40&arriveBy=1/);
    await group.locator("label", { hasText: t.Journey.now }).click();
    await expect(page).not.toHaveURL(/time=|arriveBy=/);
    await expect(page).toHaveURL(/from=005513748&to=005512401/);
});
