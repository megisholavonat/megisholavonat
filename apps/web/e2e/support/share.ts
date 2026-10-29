import type { Page } from "@playwright/test";

/** Captures what the page hands to the share sheet. */
export async function captureShare(page: Page) {
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

/**
 * A browser without a share sheet: sharing copies to the clipboard, which
 * this captures.
 */
export async function captureCopy(page: Page) {
    await page.addInitScript(() => {
        const w = window as unknown as { copied: string[] };
        w.copied = [];
        Object.defineProperty(navigator, "share", {
            configurable: true,
            value: undefined,
        });
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
                writeText: async (text: string) => {
                    w.copied.push(text);
                },
            },
        });
    });
    return () =>
        page.evaluate(() => (window as unknown as { copied: string[] }).copied);
}
