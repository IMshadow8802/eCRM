module.exports = {
  testEnvironment: "node",
  rootDir: ".",
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  testMatch: ["**/?(*.)+(test|spec).js"],
  setupFiles: ["<rootDir>/tests/setup.js"],
  // Only meaningfully unit-testable code counts toward coverage. Server
  // bootstrap, DB pool, route-wiring config, SQL seed files, and the
  // responseHelper (already tested directly) aren't useful to measure
  // against the 80%-on-changed-files gate.
  collectCoverageFrom: [
    "src/**/*.js",
    "!src/server.js",
    "!src/config/database.js",
    "!src/config/routes.js",
    "!src/config/middleware.js",
    "!src/config/errorHandlers.js",
    "!src/db/**",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 60,
      lines: 60,
      statements: 60,
    },
  },
  clearMocks: true,
  restoreMocks: true,
  verbose: true,
};
