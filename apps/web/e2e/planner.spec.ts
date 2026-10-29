import type { Page } from "@playwright/test";
import { expect, openHome, STATIONS, t, test } from "./support/test";

async function pick(page: Page, field: string, query: string, name: string) {
    const input = page.getByRole("searchbox", { name: field });
    // The first empty field opens in edit mode
    if (!(await input.isVisible())) {
        await page.getByRole("button", { name: field, exact: true }).click();
    }
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
