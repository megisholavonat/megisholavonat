import {
    boardRegion,
    expect,
    openTrain,
    STATIONS,
    TRAINS,
    t,
    test,
    trainRegion,
} from "./support/test";

// The station and train pages render on the server, from the fixture API
// (support/stub-api.mjs). Links are absolute on the production origin.
const SITE = "https://megisholavonat.info";

/** `<link rel=…>` tags of a page's HTML, as rel/hreflang -> href */
function links(html: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const tag of html.match(/<link [^>]*>/g) ?? []) {
        const rel = tag.match(/rel="([^"]+)"/)?.[1];
        const href = tag.match(/href="([^"]+)"/)?.[1];
        const lang = tag.match(/hrefLang="([^"]+)"/i)?.[1];
        if (rel === "canonical" && href) out.canonical = href;
        if (rel === "alternate" && lang && href) out[lang] = href;
    }
    return out;
}

test("SEO-1: a station page is server-rendered with its canonical URL", async ({
    page,
    request,
}) => {
    const response = await request.get("/hu/allomas/szolnok");
    expect(response.status()).toBe(200);
    const html = await response.text();
    // The board is in the HTML itself, not loaded by the browser
    expect(html).toMatch(/<h1[^>]*>Szolnok<\/h1>/);
    expect(html).toContain(t.Pages.departures);
    expect(html).toContain('"@type":"TrainStation"');
    expect(html).toContain('"@type":"BreadcrumbList"');
    expect(links(html)).toEqual({
        canonical: `${SITE}/hu/allomas/szolnok`,
        hu: `${SITE}/hu/allomas/szolnok`,
        en: `${SITE}/en/station/szolnok`,
        "x-default": `${SITE}/hu/allomas/szolnok`,
    });
    expect(html).toMatch(/<title>Szolnok: [^<]+<\/title>/);

    const english = await (await request.get("/en/station/szolnok")).text();
    expect(links(english).canonical).toBe(`${SITE}/en/station/szolnok`);
    expect(english).toContain("Departures");

    // Board rows lead to the trains' pages
    await page.goto("/hu/allomas/szolnok");
    await expect(
        page.getByRole("heading", { level: 1, name: "Szolnok" }),
    ).toBeVisible();
    await expect(
        page.getByRole("link", { name: /^2619\b/ }).first(),
    ).toHaveAttribute("href", "/hu/vonat/2619");
});

test("SEO-2: the station page's map link opens its board on the map", async ({
    page,
}) => {
    await page.goto("/hu/allomas/szolnok");
    await page.getByRole("link", { name: t.Pages.map_link }).click();
    await expect(page).toHaveURL(/\/hu\?station=005513748$/);
    await expect(boardRegion(page, STATIONS.szolnok.name)).toBeVisible();
});

test("SEO-3: a train page tells today's run, the usual route and links on", async ({
    page,
    request,
}) => {
    const html = await (await request.get("/hu/vonat/8")).text();
    expect(html).toContain('"@type":"TrainTrip"');
    expect(links(html)).toMatchObject({
        canonical: `${SITE}/hu/vonat/8`,
        hu: `${SITE}/hu/vonat/8`,
        en: `${SITE}/en/train/8`,
    });
    expect(html).toMatch(/<title>8-as vonat RUTHENIA: [^<]+<\/title>/);

    await page.goto("/hu/vonat/8");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
        "RUTHENIA",
    );
    // Today's stops link to their stations' pages
    await expect(
        page.getByRole("link", { name: "Szolnok", exact: true }),
    ).toHaveAttribute("href", "/hu/allomas/szolnok");

    await page.getByRole("link", { name: t.Pages.map_link }).click();
    await expect(page).toHaveURL(
        `/hu?vehicleId=${encodeURIComponent(TRAINS.delayed.id)}`,
    );
    await expect(trainRegion(page)).toBeVisible();
});

test("SEO-4: unknown stations and trains are real 404s", async ({
    page,
    request,
}) => {
    for (const path of [
        "/hu/allomas/nincs-ilyen-allomas",
        "/en/station/999999999",
        "/hu/vonat/99999",
        "/en/train/abc",
    ]) {
        expect((await request.get(path)).status(), path).toBe(404);
    }
    await page.goto("/hu/vonat/99999");
    await expect(
        page.getByRole("heading", { name: t.Pages.train_not_found }),
    ).toBeVisible();
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute(
        "content",
        /noindex/,
    );
});

test("SEO-5: other addresses redirect to the canonical one", async ({
    request,
}) => {
    const target = async (path: string) => {
        const response = await request.get(path, { maxRedirects: 0 });
        expect(response.status(), path).toBe(308);
        return response.headers().location;
    };
    expect(await target("/hu/allomas/Szolnok")).toBe("/hu/allomas/szolnok");
    expect(await target("/hu/allomas/005513748")).toBe("/hu/allomas/szolnok");
    expect(await target("/en/allomas/szolnok")).toBe("/en/station/szolnok");
    expect(await target("/hu/stats/train/8")).toBe("/hu/vonat/8");
    expect(await target("/hu/stats/station/005513748")).toBe(
        "/hu/allomas/szolnok",
    );
});

test("SEO-6: the sitemap lists stations and trains, robots.txt points to it", async ({
    request,
}) => {
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain(`<loc>${SITE}/hu/allomas/szolnok</loc>`);
    expect(sitemap).toContain(`<loc>${SITE}/en/station/budapest-keleti</loc>`);
    expect(sitemap).toContain(`<loc>${SITE}/hu/vonat/8</loc>`);
    expect(sitemap).toContain(`<loc>${SITE}/en/train/6009</loc>`);

    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    expect(robots).toContain("Disallow: /hu/og");
    expect(robots).toContain("Disallow: /api/");
});

test("SEO-7: the train sheet's punctuality row opens the train's page", async ({
    page,
}) => {
    const sheet = await openTrain(page, "delayed", "full");
    await sheet.getByRole("link", { name: t.Train.history }).click();
    await expect(page).toHaveURL("/hu/vonat/8");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
        "RUTHENIA",
    );
});

test("SEO-8: the station page's lists read in order, late rows at their expected time", async ({
    page,
}) => {
    await page.goto("/hu/allomas/szolnok");
    const list = (name: string) =>
        page.locator("section").filter({
            has: page.getByRole("heading", { level: 2, name, exact: true }),
        });
    for (const name of [t.Pages.departures, t.Pages.arrivals]) {
        const times = await list(name)
            .locator("li > span:first-child > span:first-child")
            .allTextContents();
        expect(times.length).toBeGreaterThan(3);
        expect([...times].sort()).toEqual(times);
    }
    // Train 7 arrives 40 minutes late: shown at the expected 04:37, its
    // scheduled 03:57 struck through, as on the map's board
    const late = list(t.Pages.arrivals)
        .locator("li")
        .filter({ hasText: /\b7\b/ })
        .filter({ hasText: "04:37" });
    await expect(late.locator("s")).toContainText("03:57");
});
