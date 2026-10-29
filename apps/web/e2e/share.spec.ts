import { captureCopy, captureShare } from "./support/share";
import { expect, openTrain, TRAINS, t, test } from "./support/test";

// Sharing sends the link alone, never a prefilled message (people delete
// it): the link's preview tags carry what the train is doing.

const trainUrl = new RegExp(
    `/hu\\?vehicleId=${encodeURIComponent(TRAINS.delayed.id)}$`,
);

test("the train share sheet gets the title and link, no text", async ({
    page,
}) => {
    const shared = await captureShare(page);
    const sheet = await openTrain(page, "delayed", "full");
    await sheet.getByRole("button", { name: t.Train.share }).click();
    await expect.poll(shared).toHaveLength(1);
    const [data] = await shared();
    expect(Object.keys(data ?? {}).sort()).toEqual(["title", "url"]);
    expect(data?.title).toMatch(/^8 → /);
    expect(data?.url).toMatch(trainUrl);
});

test("without a share sheet, the bare train link is copied", async ({
    page,
}) => {
    const copied = await captureCopy(page);
    const sheet = await openTrain(page, "delayed", "full");
    await sheet.getByRole("button", { name: t.Train.share }).click();
    await expect.poll(copied).toHaveLength(1);
    const [text] = await copied();
    expect(text).toMatch(/^http:\/\/[^\s]+$/);
    expect(text).toMatch(trainUrl);
    await expect(
        sheet.getByRole("button", { name: t.Train.copied }),
    ).toBeVisible();
});

test("a train link previews its delay: title, description, image", async ({
    page,
}) => {
    await page.goto(`/hu?vehicleId=${encodeURIComponent(TRAINS.delayed.id)}`);
    const meta = (property: string) =>
        page.locator(`meta[property="${property}"]`).getAttribute("content");
    expect(await meta("og:title")).toMatch(/^8 RUTHENIA → /);
    // The server reads the fixture with its own clock: "nincs friss adat"
    expect(await meta("og:description")).toMatch(/^A 8-as vonat/);
    expect(await meta("og:image")).toMatch(/\/hu\/og\/train\//);
    expect(await meta("og:url")).toMatch(trainUrl);
});
