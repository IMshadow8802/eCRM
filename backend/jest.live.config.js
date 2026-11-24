// Live leak suite against a running backend on TestCRM (plan 2026-11-22
// Task 28). Run by the owner: `pnpm test:live` (all files, in band) or
// `pnpm test:live matrix legacy`. The default jest.config.js matches only
// *.test.js / *.spec.js, so these *.live.js files never run in `pnpm test`.
module.exports = {
  testEnvironment: "node",
  rootDir: ".",
  roots: ["<rootDir>/tests/live"],
  testMatch: ["<rootDir>/tests/live/**/*.live.js"],
  setupFiles: ["<rootDir>/tests/live/env.js"],
  // One fresh set of records per run (tests/live/fixtures.js), so runs repeat
  // back to back with no re-seed. matrix / roles / legacy read it, flows
  // moves it, shape restores what it changes.
  globalSetup: "<rootDir>/tests/live/globalSetup.js",
  testSequencer: "<rootDir>/tests/live/sequencer.js",
  collectCoverage: false,
  testTimeout: 30000,
  verbose: true,
};
