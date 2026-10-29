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
