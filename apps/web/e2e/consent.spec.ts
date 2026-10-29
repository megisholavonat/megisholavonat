import type { Page } from "@playwright/test";
import { expect, openHome, t, test } from "./support/test";

test.use({ consent: "pending" });

/** Skip the minute of use the prompt waits for */
async function promptNow(page: Page) {
    await page.addInitScript(() =>
        sessionStorage.setItem("mhav.consent.prompt", "1"),
    );
}

const storedConsent = (page: Page) =>
    page.evaluate(() => {
        const raw = localStorage.getItem("mhav.consent.analytics");
        return raw ? (JSON.parse(raw).value as string) : null;
    });

/** PostHog keeps an identity in localStorage only with consent */
const posthogStorage = (page: Page) =>
    page.evaluate(() =>
        Object.keys(localStorage).filter((key) => /^(__)?ph_/.test(key)),
    );

async function consentSwitch(page: Page) {
    await page.getByRole("button", { name: t.Settings.title }).click();
    const dialog = page.getByRole("dialog", { name: t.Settings.title });
    return dialog.getByRole("switch", {
        name: t.AnalyticsConsentSwitch.label,
    });
}

test("no prompt before the user has used the app", async ({ page }) => {
    await openHome(page);
    await expect(
        page.getByRole("region", { name: t.Consent.title }),
    ).toHaveCount(0);
});

test("accepting turns on persistent analytics", async ({ page, analytics }) => {
    await promptNow(page);
    await openHome(page);
    const card = page.getByRole("region", { name: t.Consent.title });
    await card.getByRole("button", { name: t.Consent.accept }).click();
    await expect(card).toHaveCount(0);
    expect(await storedConsent(page)).toBe("granted");
    await expect.poll(() => posthogStorage(page)).not.toEqual([]);
    await expect.poll(() => analytics.length).toBeGreaterThan(0);

    // The choice sticks, and the settings switch reflects it
    await page.reload();
    await expect(
        page.getByRole("region", { name: t.Consent.title }),
    ).toHaveCount(0);
    await expect(await consentSwitch(page)).toBeChecked();
});

test("rejecting keeps analytics cookieless", async ({ page }) => {
    await promptNow(page);
    await openHome(page);
    const card = page.getByRole("region", { name: t.Consent.title });
    await card.getByRole("button", { name: t.Consent.reject }).click();
    await expect(card).toHaveCount(0);
    expect(await storedConsent(page)).toBe("denied");

    await page.reload();
    await expect(
        page.getByRole("region", { name: t.Consent.title }),
    ).toHaveCount(0);
    expect(await posthogStorage(page)).toEqual([]);
    const toggle = await consentSwitch(page);
    await expect(toggle).not.toBeChecked();

    // Turning it on in settings grants it
    await toggle.click();
    await expect(toggle).toBeChecked();
    expect(await storedConsent(page)).toBe("granted");
});
