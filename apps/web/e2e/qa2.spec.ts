// Fixes from QA round 2 (web): tab title, train header, county on tap,
// mouse drag, legend, search copy, reduced-motion skeletons.
import {
    expect,
    openHome,
    openSearch,
    openTrain,
    t,
    test,
    trainRegion,
} from "./support/test";

const APP = t.Home.app_title;
const APP_RE = APP.replace(/[?.]/g, "\\$&");

test("n-1: the tab names the open train, then the app again", async ({
    page,
}) => {
    const region = await openTrain(page, "delayed", "peek");
    await expect(page).toHaveTitle(new RegExp(`^8 RUTHENIA → .+ · ${APP_RE}$`));
    await page.keyboard.press("Escape");
    await expect(region).toBeHidden();
    await expect(page).toHaveTitle(APP);
});

test("n-7: the header never cuts the next stop for its time", async ({
    page,
}) => {
    const region = await openTrain(page, "delayed", "peek");
    const cut = await region.evaluate((el) =>
        [...el.querySelectorAll(".truncate, .line-clamp-2")]
            .filter(
                (e) =>
                    e.scrollWidth > e.clientWidth + 1 ||
                    e.scrollHeight > e.clientHeight + 1,
            )
            .map((e) => e.textContent),
    );
    expect(cut).toEqual([]);
});

test("n-8: stop names are no tab stops and open no popover", async ({
    page,
}) => {
    const region = await openTrain(page, "delayed", "full");
    const list = region.getByRole("list").first();
    await expect(list).toBeVisible();
    // The county is read with the name
    await expect(list).toContainText(/vármegye/);
    const stopButtons = list.locator("button[aria-hidden='true']");
    expect(await stopButtons.count()).toBeGreaterThan(2);
    for (const tabIndex of await stopButtons.evaluateAll((els) =>
        els.map((e) => (e as HTMLElement).tabIndex),
    )) {
        expect(tabIndex).toBe(-1);
    }
    // Resting the mouse on a name opens nothing
    await stopButtons.nth(1).hover();
    await page.waitForTimeout(700);
    await expect(
        page.locator("[data-radix-popper-content-wrapper]"),
    ).toHaveCount(0);
    // A tap shows the county under the name; Esc then still closes the train
    await stopButtons.nth(1).click();
    await expect(
        list.locator("span[aria-hidden='true']", { hasText: /vármegye/ }),
    ).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(trainRegion(page)).toBeHidden();
});

test("n-10: a mouse drags the sheet up and down in a narrow window", async ({
    page,
    isPhone,
}) => {
    test.skip(isPhone, "a desktop browser with a mouse");
    await page.setViewportSize({ width: 600, height: 900 });
    const region = await openTrain(page, "delayed", "peek");
    const handle = region.getByRole("button", { name: t.Sheet.resize });
    const top = async () => (await handle.boundingBox())?.y ?? 0;
    const drag = async (dy: number) => {
        const box = await handle.boundingBox();
        if (!box) throw new Error("no handle");
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (let i = 1; i <= 12; i++) {
            await page.mouse.move(x, y + (dy * i) / 12);
        }
        await page.mouse.up();
    };
    const peek = await top();
    await drag(-300);
    // Up one detent, and the click after the drag does not step it again
    await expect.poll(top).toBeLessThan(peek - 150);
    const half = await top();
    await drag(-400);
    await expect.poll(top).toBeLessThan(half - 150);
    const full = await top();
    await drag(300);
    await expect.poll(top).toBeGreaterThan(full + 150);
});

test("q-3: the phone legend says what its dots are", async ({
    page,
    isPhone,
}) => {
    test.skip(!isPhone, "phone legend");
    await openHome(page);
    await expect(
        page.getByRole("button", { name: t.Legend.label }),
    ).toContainText(t.Legend.title);
});

test("q-9: a train number not running now says so", async ({ page }) => {
    await openHome(page);
    const field = await openSearch(page);
    await field.fill("99999");
    await expect(
        page.getByText("A 99999-es vonat most nem közlekedik"),
    ).toBeVisible();
});

test("q-5: no pulsing placeholders under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route(/\/api\/v1\/rankings/, () => {
        // Never answers: the placeholders stay
    });
    await page.goto("/stats");
    await expect(
        page.locator(".motion-safe\\:animate-pulse").first(),
    ).toBeVisible();
    const pulsing = await page.evaluate(
        () =>
            document
                .getAnimations()
                .filter((a) => (a as CSSAnimation).animationName === "pulse")
                .length,
    );
    expect(pulsing).toBe(0);
});
