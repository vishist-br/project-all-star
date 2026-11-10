import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3211);
// Playwright 1.65 cannot download browsers on some macOS versions (e.g. mac13). Default to the
// system Google Chrome, which needs no download. In CI set E2E_BROWSER_CHANNEL=chromium after
// `npx playwright install chromium`.
const channel = process.env.E2E_BROWSER_CHANNEL ?? "chrome";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: channel === "chromium" ? undefined : channel,
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx tsx e2e/run-server.ts",
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
