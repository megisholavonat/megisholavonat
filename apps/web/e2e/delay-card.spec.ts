import type { Page } from "@playwright/test";
import { expect, openHome, openTrain, t, test } from "./support/test";

const c = t.DelayCard;

/** Captures what the page hands to the share sheet. */
async function captureShare(page: Page) {
    await page.addInitScript(() => {
        const w = window as unknown as { shared: ShareData[] };
        w.shared = [];
        Object.defineProperty(navigator, "share", {
            configurable: true,
            value: async (data: ShareData) => {
                w.shared.push(data);
            },
        });
    });
    return () =>
        page.evaluate(
            () => (window as unknown as { shared: ShareData[] }).shared,
        );
}

test("the card page tells a finished run with its measurement note", async ({
    page,
}) => {
    const response = await page.goto("/hu/kesesek/5009/2026-10-27");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "A 3:25-ös Miskolc-Tiszai → Budapest-Keleti október 27-én 29 percet késett, utolsó mérés: Gödöllő",
    );
    await expect(
        page.getByText("Mégis hol a vonat? mérés, nem hivatalos MÁV igazolás"),
    ).toBeVisible();
    // The card itself, drawn by the og route
    const card = page.getByRole("img", { name: /Késéskártya/ });
    await expect(card).toBeVisible();
    await expect
        .poll(() => card.evaluate((img: HTMLImageElement) => img.naturalWidth))
        .toBe(1200);
    // Shared as its own preview, on the site's own origin
    const ogImage = page.locator('meta[property="og:image"]');
    await expect(ogImage).toHaveAttribute(
        "content",
        /\/hu\/og\/run\/5009\/2026-10-27$/,
    );
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
        "content",
        "https://megisholavonat.info/hu/kesesek/5009/2026-10-27",
    );
    await expect(page.getByRole("link", { name: c.open_map })).toHaveAttribute(
        "href",
        "/hu",
    );
});

test("the card page keeps the rider's stops and drops bad ones", async ({
    page,
}) => {
    await page.goto(
        "/en/kesesek/2019/2026-10-27?from=005501495&to=005501404&x=1",
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "The 4:05 Dorog → Óbuda was on time on 27 October",
    );
    await page.goto("/hu/kesesek/2019/2026-10-27?from=%3Cscript%3E");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
        "Esztergom → Budapest-Nyugati",
    );
});

test("cancelled and unmeasured runs say so", async ({ page }) => {
    await page.goto("/hu/kesesek/2021/2026-10-27");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        /október 27-én elmaradt$/,
    );
    await page.goto("/hu/kesesek/2023/2026-10-27");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        /: nincs mért késés$/,
    );
});

for (const path of [
    "/hu/kesesek/9999/2026-10-27",
    "/hu/kesesek/5009/2026-02-30",
    "/hu/kesesek/50%2009/2026-10-27",
    "/hu/kesesek/5009/yesterday",
]) {
    test(`unknown or malformed runs are 404: ${path}`, async ({ page }) => {
        const response = await page.goto(path);
        expect(response?.status()).toBe(404);
        await expect(
            page.getByRole("heading", { name: c.not_found }),
        ).toBeVisible();
    });
}

test("the card image is a PNG", async ({ request }) => {
    const response = await request.get("/hu/og/run/5009/2026-10-27");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");
});

test("the train sheet shares the delay so far", async ({ page }) => {
    const shared = await captureShare(page);
    const sheet = await openTrain(page, "late", "full");
    const button = sheet.getByRole("button", { name: c.share_so_far });
    await button.scrollIntoViewIfNeeded();
    await button.click();
    await expect.poll(shared).toHaveLength(1);
    const [data] = await shared();
    expect(data?.url).toMatch(/\/hu\/kesesek\/9\/2026-10-28$/);
    expect(data?.text).toBe(
        "A 9:18-as Kyiv-Pas. → Budapest-Keleti eddig 8 percet késett, utolsó mérés: Debrecen (Mégis hol a vonat? GPS-mérés)",
    );
});

test("a commute row shares the delay after the run", async ({ page }) => {
    const shared = await captureShare(page);
    await page.addInitScript(() => {
        localStorage.setItem(
            "mhav.follows",
            JSON.stringify([
                {
                    id: "e2e",
                    trainNumber: "2019",
                    routeShortName: "S72",
                    destination: "Budapest-Nyugati",
                    fromStationId: "005501511",
                    fromName: "Esztergom",
                    fromLat: 47.79,
                    fromLon: 18.74,
                    // Left at 1:00, two hours before the e2e clock
                    departureS: 3600,
                    weekdays: [1, 2, 3, 4, 5, 6, 7],
                    date: null,
                    createdAt: 1,
                },
            ]),
        );
    });
    await openHome(page);
    const button = page.getByRole("button", { name: c.share }).first();
    await button.click();
    await expect.poll(shared).toHaveLength(1);
    const [data] = await shared();
    expect(data?.url).toMatch(
        /\/hu\/kesesek\/2019\/2026-10-29\?from=005501511$/,
    );
    expect(data?.text).toMatch(/^A 3:56-os Esztergom → Budapest-Nyugati /);
});
