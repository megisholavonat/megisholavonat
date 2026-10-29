import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3210);
const baseURL = `http://127.0.0.1:${PORT}`;
const API_PORT = Number(process.env.E2E_API_PORT ?? PORT + 1);
const apiURL = `http://127.0.0.1:${API_PORT}`;

export default defineConfig({
    testDir: ".",
    testMatch: "**/*.spec.ts",
    outputDir: "test-results",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 2 : undefined,
    reporter: process.env.CI
        ? [["github"], ["html", { open: "never", outputFolder: "report" }]]
        : [["list"]],
    timeout: 30_000,
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
            // The API the server-rendered pages read, from the fixtures
            command: `node support/fixture-api.mjs ${API_PORT}`,
            url: `${apiURL}/`,
            reuseExistingServer: !process.env.CI,
            timeout: 10_000,
            cwd: ".",
        },
        {
            // Serves the production build: run `next build` first (turbo's
            // e2e task does)
            command: `pnpm exec next start -p ${PORT} -H 127.0.0.1`,
            url: baseURL,
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
            cwd: "..",
            env: { API_URL: apiURL },
        },
    ],
});
