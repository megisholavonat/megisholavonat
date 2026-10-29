import { expect, test } from "@playwright/test";

// The files iOS and Android fetch to let share links open the app: served
// as JSON, straight (no locale redirect)
for (const path of [
    "/.well-known/apple-app-site-association",
    "/.well-known/assetlinks.json",
]) {
    test(`${path} is served as JSON`, async ({ request }) => {
        const response = await request.get(path, { maxRedirects: 0 });
        expect(response.status()).toBe(200);
        expect(response.headers()["content-type"]).toMatch(
            /^application\/json\b/,
        );
        const body = JSON.stringify(await response.json());
        expect(body).toContain("info.megisholavonat.app");
    });
}
