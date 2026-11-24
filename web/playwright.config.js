// Playwright: the access-model flows, one project per role (plan 2026-11-22
// Task 29). Local web -> local backend (localhost:5001) -> TestCRM only; the
// guard is in e2e/personas.js. Every run works on records it creates itself
// (global-setup.js), so no re-seed is needed between runs. One worker, in order.
import { defineConfig } from "@playwright/test";

import { WEB_URL, authFile } from "./e2e/personas.js";

// Each role's spec and the persona whose saved session it opens with. A spec
// that needs a second persona opens its own context from authFile(<name>).
const ROLES = [
  ["desk", "nitin"],
  ["agent", "vinod"],
  ["teamlead", "rohit"],
  ["manager", "neha"],
  ["sales", "kasak"],
  ["admin", "amit"],
];

export default defineConfig({
  testDir: "e2e",
  // Creates this run's own records (backend/tests/live/fixtures.js) -> e2e/.auth/run.json.
  globalSetup: "./e2e/global-setup.js",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: WEB_URL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1600, height: 1000 },
  },
  webServer: {
    command: "VITE_API_BASE_URL=http://localhost:5001 BROWSER=none pnpm dev --port 8080 --strictPort",
    url: WEB_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    // No trace or screenshot of the sign-in: a trace records what was typed.
    { name: "setup", testMatch: /auth\.setup\.js/, use: { trace: "off", screenshot: "off" } },
    // One worker runs the roles in this order (each builds on the seed state the
    // ones before left); none depends on another, so one failure does not hide the rest.
    ...ROLES.map(([role, persona]) => ({
      name: role,
      testMatch: new RegExp(`access-model/${role}\\.spec\\.js`),
      dependencies: ["setup"],
      use: { storageState: authFile(persona) },
    })),
  ],
});
