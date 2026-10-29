import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3210);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
    testDir: ".",
    testMatch: "**/*.spec.ts",
    outputDir: "test-results",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 2 : undefined,
    // On CI each test is listed as it ends, so a slow or stuck one shows in
    // the log while the run is still going
    reporter: process.env.CI
        ? [
              ["list"],
              ["github"],
              ["html", { open: "never", outputFolder: "report" }],
          ]
        : [["list"]],
    // A test that loads the page several times needs more on a busy runner
    timeout: process.env.CI ? 45_000 : 30_000,
    // Stops a stuck run with a report of what was still running, before the
    // CI step's own timeout cancels it silently
    globalTimeout: process.env.CI ? 8 * 60_000 : undefined,
    expect: { timeout: 7_500 },
    use: {
        baseURL,
        browserName: "chromium",
        // Full Chromium in new headless mode: MapLibre needs WebGL 2, which
        // SwiftShader provides without a GPU
        channel: "chromium",
        locale: "hu-HU",
        // SwiftShader draws WebGL on the CPU. On a CI runner's few slow
        // cores the map's camera eases starve the compositor: panel fades
        // stall mid-way and a closed panel stays on screen. Reduced motion
        // skips those there; local runs keep full motion, and motion.spec
        // sets its own
        contextOptions: process.env.CI ? { reducedMotion: "reduce" } : {},
        timezoneId: "Europe/Budapest",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        launchOptions: {
            // A system Chromium, where Playwright's own build cannot run
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
            args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
        },
    },
    projects: [
        {
            name: "phone",
            use: {
                viewport: { width: 390, height: 844 },
                deviceScaleFactor: 2,
                isMobile: true,
                hasTouch: true,
            },
        },
        {
            name: "desktop",
            use: { viewport: { width: 1440, height: 900 } },
        },
    ],
    webServer: {
        // Serves the production build: run `next build` first (turbo's e2e
        // task does)
        command: `pnpm exec next start -p ${PORT} -H 127.0.0.1`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        cwd: "..",
    },
});
