// Every user is in IST. Set here, in the main jest process before any worker
// starts, so the zone does not depend on the machine (or a `TZ=` in the shell).
// A `process.env.TZ` inside a test file does nothing: the test sandbox's env
// is not the worker's.
process.env.TZ = "Asia/Kolkata";

module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  // Call history resets per test; implementations set in jest.setup survive.
  clearMocks: true,
  // Read only when coverage is collected (`pnpm test:coverage`); `pnpm test` ignores both.
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/**/*.test.*", "!src/test/**", "!src/types/**"],
  // Measured 2026-11-02 after Task 32 visual pass (98.32/93.25/97.31/98.91), rounded down. Never lower it.
  coverageThreshold: { global: { statements: 98, branches: 93, functions: 97, lines: 98 } },
  testPathIgnorePatterns: ["/node_modules/", "/android/", "/ios/"],
  // pnpm keeps packages under node_modules/.pnpm, so the allowlist matches the
  // package name after any "node_modules/" segment.
  // lucide's RN entry is an untransformed .mjs; its CJS build needs no transform.
  moduleNameMapper: {
    "^lucide-react-native$": "<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js",
  },
  transformIgnorePatterns: [
    "node_modules/(?!(\\.pnpm/[^/]+/node_modules/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@gorhom/.*|react-native-svg))",
  ],
};
