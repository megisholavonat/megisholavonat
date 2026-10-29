import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3210);
const baseURL = `http://127.0.0.1:${PORT}`;
const STUB_API_PORT = PORT + 1;

export default defineConfig({
    testDir: ".",
    testMatch: "**/*.spec.ts",
    outputDir: "test-results",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    // GitHub runners for public repos have 4 cores. The suite waits on the
    // page more than it computes: 4 workers there take ~2/3 the time of 2
    workers: process.env.CI ? 4 : undefined,
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
    webServer: [
        {
            // The API the Next server itself asks (the delay card pages)
            command: "node e2e/support/stub-api.mjs",
            url: `http://127.0.0.1:${STUB_API_PORT}/`,
            env: { STUB_API_PORT: String(STUB_API_PORT) },
            reuseExistingServer: !process.env.CI,
            timeout: 10_000,
            cwd: "..",
        },
        {
            // Serves the production build: run `next build` first (turbo's
            // e2e task does)
            command: `pnpm exec next start -p ${PORT} -H 127.0.0.1`,
            url: baseURL,
            env: { API_URL: `http://127.0.0.1:${STUB_API_PORT}` },
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
            cwd: "..",
        },
    ],
});
