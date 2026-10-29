import type { Locator, Page } from "@playwright/test";
import {
    DELAY_NUMBER,
    expect,
    knownGap,
    openHome,
    openTrain,
    t,
    test,
    trainRegion,
} from "./support/test";

/** Texts in the sheet's header that are a delay number */
const delayNumber = (region: Locator) => region.getByText(DELAY_NUMBER).first();

test("a delayed train shows its delay in minutes", async ({ page }) => {
    const region = await openTrain(page, "delayed", "peek");
    await expect(delayNumber(region)).toHaveText(/\+\s?45/);
});

test("P3: an on-time train shows a number, not just 'pontos'", async ({
    page,
}) => {
    const region = await openTrain(page, "ontime", "peek");
    await expect(delayNumber(region)).toBeVisible();
});

test("P3: an early train shows a signed number", async ({ page }) => {
    const region = await openTrain(page, "early", "peek");
    await expect(delayNumber(region)).toHaveText(/[−-]\s?1/);
});

test("P4: a stale train marks its delay as uncertain", async ({ page }) => {
    const region = await openTrain(page, "stale", "peek");
    await expect(delayNumber(region)).toHaveText(/\?/);
});

test("P4: an inactive HÉV does not show a live delay", async ({ page }) => {
    const region = await openTrain(page, "hev", "peek");
    await expect(region).toContainText("H8000");
    // Standing at its terminus: no delay at all, the tile shows "–"
    await expect(region.getByText("–", { exact: true }).first()).toBeVisible();
    await expect(region.getByText(/\+\s?127/)).toHaveCount(0);
});

test("P1: the delay reason says it is the cause of the delay", async ({
    page,
}) => {
    const region = await openTrain(page, "delayed", "half");
    const reason = region.getByText("Más vonat", { exact: true }).first();
    await expect(reason).toBeVisible();
    // The label's block carries the context: "Késés oka", or the delay
    const block = reason.locator("xpath=ancestor::*[2]");
    await expect(block).toHaveText(/késés|késik|oka|miatt|\+\s?45/i);
});

test("P1: no delay reason on a train that is on time", async ({ page }) => {
    const region = await openTrain(page, "minor", "half");
    await expect(region).toContainText("6009");
    await expect(region.getByText("Műszaki hiba")).toBeHidden();
});

/** Vertical centre of a locator */
async function centerY(locator: Locator): Promise<number> {
    const box = await locator.boundingBox();
    if (!box) throw new Error("not rendered");
    return box.y + box.height / 2;
}

/**
 * Where the live position sits between the last and the next stop, as a
 * share of the gap between their names (0 = last stop, 1 = next stop).
 */
async function positionShare(
    page: Page,
    role: "delayed" | "minor" | "ontime",
    last: string,
    next: string,
) {
    const region = await openTrain(page, role, "full");
    const list = region.getByRole("list").first();
    const indicator = list
        .getByText(/\d+\s?km\/h|^áll$/)
        .filter({ visible: true })
        .first();
    await expect(indicator).toBeVisible();
    const lastStop = list.getByText(last, { exact: true }).first();
    const nextStop = list.getByText(next, { exact: true }).first();
    await lastStop.scrollIntoViewIfNeeded();
    const [y, a, b] = await Promise.all([
        centerY(indicator),
        centerY(lastStop),
        centerY(nextStop),
    ]);
    return (y - a) / (b - a);
}

test("the stop list shows where a running train is", async ({ page }) => {
    const share = await positionShare(page, "delayed", "Nyíregyháza", "Záhony");
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(1);
});

test("P2: the position marker moves along the rail", async ({ page }) => {
    // The fixtures' progress: 6009 is 55 % of the way from Püspökladány to
    // Karcag, and its 86 km/h over the 98 s since its last report carries
    // it on to about 70 %; 2909 is 17 % from Örkény to Hernád, about 35 %
    // with its 50 km/h over 55 s. The marker keeps clear of the stop dots,
    // so the label's share of the gap between the names is a little
    // compressed towards the middle.
    const minor = await positionShare(page, "minor", "Püspökladány", "Karcag");
    const ontime = await positionShare(page, "ontime", "Örkény", "Hernád");
    expect(Math.abs(minor - 0.65)).toBeLessThan(0.12);
    expect(Math.abs(ontime - 0.35)).toBeLessThan(0.12);
    expect(minor).toBeGreaterThan(ontime);
});

test("follow and unfollow survive a reload", async ({ page, isPhone }) => {
    const region = await openTrain(page, "delayed", "half");
    await region.getByRole("button", { name: t.Follow.follow }).click();
    const editor = page.getByRole("dialog");
    await expect(editor).toContainText("8");
    await editor.getByRole("button", { name: t.Follow.save }).click();
    await expect(editor).toBeHidden();
    const following = region.getByRole("button", { name: t.Follow.following });
    await expect(following).toHaveAttribute("aria-pressed", "true");

    // The follow is listed on the home screen after a reload
    await openHome(page);
    const commute = page.getByRole("region", { name: t.Follow.my_commute });
    await expect(commute).toBeVisible();
    // Boarding defaults to the train's next stop
    await expect(commute).toContainText("Záhony");

    // And still marked on the train
    await openTrain(page, "delayed", "half");
    await trainRegion(page)
        .getByRole("button", { name: t.Follow.following })
        .click();
    await page.getByRole("button", { name: t.Follow.unfollow }).click();
    await expect(
        trainRegion(page).getByRole("button", { name: t.Follow.follow }),
    ).toHaveAttribute("aria-pressed", "false");

    await openHome(page);
    await expect(
        page.getByRole("region", { name: t.Follow.my_commute }),
    ).toHaveCount(0);
    if (isPhone) {
        await expect(
            page.getByRole("button", { name: t.Follow.follow_your_train }),
        ).toBeVisible();
    }
});
