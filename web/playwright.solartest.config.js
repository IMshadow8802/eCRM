// Playwright against SolarTest (private copy of the SolarCRM client DB) via the
// owner's backend on localhost:5001. Separate from playwright.config.js, which is
// bound to TestCRM personas. Real people sign in through the real screen per flow.
// No traces: a trace records what was typed into the password field.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e/solartest",
  globalSetup: "./e2e/solartest/global-setup.js",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL: "http://localhost:8080/prdcrm/", screenshot: "only-on-failure", trace: "off", viewport: { width: 1600, height: 1000 } },
  webServer: {
    command: "VITE_API_BASE_URL=http://localhost:5001 BROWSER=none pnpm dev --port 8080 --strictPort",
    url: "http://localhost:8080/prdcrm/",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
