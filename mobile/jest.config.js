module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  // Call history resets per test; implementations set in jest.setup survive.
  clearMocks: true,
  // Read only when coverage is collected (`pnpm test:coverage`); `pnpm test` ignores both.
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/**/*.test.*", "!src/test/**", "!src/types/**"],
  // ponytail: measured 2026-11-02 after Task 2 (27.82/18.26/26.41/28.73), rounded down; Tasks 2–7 raise it to 60.
  coverageThreshold: { global: { statements: 27, branches: 18, functions: 26, lines: 28 } },
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
