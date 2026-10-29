import type { Page } from "@playwright/test";
import { expect, knownGap, openHome, openTrain, t, test } from "./support/test";

test.use({ contextOptions: { reducedMotion: "reduce" } });

declare global {
    interface Window {
        __motion: string[];
    }
}

/**
 * Records every CSS animation and transition that moves something and takes
 * longer than a frame. Colour and opacity fades are fine with reduced motion.
 */
test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        window.__motion = [];
        const seconds = (value: string) =>
            Math.max(
                ...value
                    .split(",")
                    .map((v) =>
                        v.trim().endsWith("ms")
                            ? Number.parseFloat(v) / 1000
                            : Number.parseFloat(v),
                    ),
            );
        const describe = (target: EventTarget | null) => {
            if (!(target instanceof Element)) return "?";
            const label =
                target.getAttribute("aria-label") ??
                target.getAttribute("role") ??
                "";
            return `${target.tagName.toLowerCase()}${label ? `[${label}]` : ""}`;
        };
        const FADE =
            /^(offset|computedOffset|easing|composite|opacity|.*[cC]olor.*)$/;
        /** A keyframe animation that only fades (a skeleton's pulse) */
        const onlyFades = (target: Element, name: string) => {
            const animation = target
                .getAnimations()
                .find((a) => (a as CSSAnimation).animationName === name);
            const frames = (
                animation?.effect as KeyframeEffect | undefined
            )?.getKeyframes();
            return (
                !!frames &&
                frames.every((frame) =>
                    Object.keys(frame).every((key) => FADE.test(key)),
                )
            );
        };
        document.addEventListener(
            "animationstart",
            (e) => {
                const target = e.target as Element;
                if (onlyFades(target, e.animationName)) return;
                const style = getComputedStyle(target);
                if (seconds(style.animationDuration) > 0.02) {
                    window.__motion.push(
                        `animation ${e.animationName} on ${describe(e.target)}`,
                    );
                }
            },
            true,
        );
        document.addEventListener(
            "transitionrun",
            (e) => {
                if (/color|opacity|shadow|fill|stroke/.test(e.propertyName)) {
                    return;
                }
                const style = getComputedStyle(e.target as Element);
                if (seconds(style.transitionDuration) > 0.02) {
                    window.__motion.push(
                        `transition ${e.propertyName} on ${describe(e.target)}`,
                    );
                }
            },
            true,
        );
    });
});

/** Movement recorded since the last call */
async function motionSince(page: Page) {
    await page.waitForTimeout(100);
    return page.evaluate(() => window.__motion.splice(0));
}

test("L19: reduced motion: the sheet and the train open without animation", async ({
    page,
    isPhone,
}) => {
    knownGap("L19: the legend slides with the sheet inset", isPhone);
    await openHome(page);
    expect(await motionSince(page)).toEqual([]);

    const region = await openTrain(page, "delayed", "peek");
    expect(await motionSince(page)).toEqual([]);
    const handle = region.getByRole("button", { name: t.Sheet.resize });
    if (await handle.isVisible()) {
        await handle.click();
        expect(await motionSince(page)).toEqual([]);
    }
});

test("L20: reduced motion: settings open without animation", async ({
    page,
}) => {
    knownGap("L20: dialogs animate in despite reduced motion");
    await openHome(page);
    await motionSince(page);
    await page.getByRole("button", { name: t.Settings.title }).click();
    const dialog = page.getByRole("dialog", { name: t.Settings.title });
    await expect(dialog).toBeVisible();
    expect(await motionSince(page)).toEqual([]);
    await dialog.getByRole("button", { name: t.Settings.close }).click();
    await expect(dialog).toBeHidden();
    expect(await motionSince(page)).toEqual([]);
});
