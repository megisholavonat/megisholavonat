import type { CapturedEvent } from "./support/api";
import {
    expect,
    openHome,
    openSearch,
    openTrain,
    STATIONS,
    TRAINS,
    t,
    test,
} from "./support/test";

// PostHog drops events from browsers that look automated (headless
// Chromium's user agent, navigator.webdriver): look like a plain Chrome
test.use({
    userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
});
test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, "webdriver", {
            get: () => false,
        });
        Object.defineProperty(Navigator.prototype, "userAgentData", {
            get: () => undefined,
        });
    });
});

/** Waits for an event, sent in PostHog's next batch */
async function waitFor(
    events: CapturedEvent[],
    name: string,
): Promise<Record<string, unknown>> {
    await expect
        .poll(() => events.some((e) => e.event === name), { timeout: 20_000 })
        .toBe(true);
    return events.find((e) => e.event === name)?.properties ?? {};
}

test("a shared train link counts as a share-link landing", async ({
    page,
    events,
    isPhone,
}) => {
    await openTrain(page, "delayed", "peek");
    const open = await waitFor(events, "app_open");
    expect(open).toMatchObject({ entry: "share_link", platform: "web" });
    // Cookieless until consent: the placeholder id, nothing stored
    expect(open.distinct_id).toBe("$posthog_cookieless");

    const train = await waitFor(events, "train_opened");
    expect(train).toMatchObject({
        entry: "share_link",
        surface: isPhone ? "sheet" : "panel",
        train_number: TRAINS.delayed.number,
        followed: false,
        platform: "web",
        follows: "0",
    });
    expect(train.delay_level).toEqual(expect.any(String));
    expect(await waitFor(events, "map_ready")).toMatchObject({
        trains: expect.any(Number),
        ms: expect.any(Number),
    });
});

test("a search sends lengths and counts, never the query", async ({
    page,
    events,
}) => {
    await openHome(page);
    const field = await openSearch(page);
    await field.fill("Szolnok");
    await page
        .getByRole("option", {
            name: t.Search.station_label.replace(
                "{station}",
                STATIONS.szolnok.name,
            ),
            exact: true,
        })
        .click();

    const selected = await waitFor(events, "search_result_selected");
    expect(selected).toMatchObject({
        type: "station",
        position: 0,
        query_length: "Szolnok".length,
    });
    expect(await waitFor(events, "station_opened")).toMatchObject({
        entry: "search",
        station_id: STATIONS.szolnok.id,
    });
    await waitFor(events, "search_opened");
    for (const e of events.filter((e) => !e.event.startsWith("$"))) {
        expect(JSON.stringify(e.properties)).not.toContain("Szolnok");
    }
});

test.describe("consent", () => {
    test.use({ consent: "pending" });

    test("the decision itself is counted, cookieless", async ({
        page,
        events,
    }) => {
        await page.addInitScript(() =>
            sessionStorage.setItem("mhav.consent.prompt", "1"),
        );
        await openHome(page);
        const card = page.getByRole("region", { name: t.Consent.title });
        // PostHog loads after the page; let it start before answering
        await waitFor(events, "app_open");
        await card.getByRole("button", { name: t.Consent.accept }).click();

        expect(await waitFor(events, "consent_shown")).toMatchObject({
            surface: "banner",
        });
        const decided = await waitFor(events, "consent_decided");
        expect(decided).toMatchObject({
            decision: "granted",
            source: "prompt",
            distinct_id: "$posthog_cookieless",
        });
    });
});
