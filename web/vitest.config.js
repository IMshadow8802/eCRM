import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.js"],
    css: false,
    include: ["src/**/*.{test,spec}.{js,jsx}"],
    exclude: ["node_modules", "dist-web", "dist"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{js,jsx}"],
      // Bootstrap, router wiring, static data, and assets aren't useful
      // to measure against the 80%-on-changed-files gate.
      exclude: [
        "src/**/*.{test,spec}.{js,jsx}",
        "src/test/**",
        "src/main.jsx",
        "src/App.jsx",
        "src/theme.js",
        "src/Data.js",
        "src/data/**",
        "src/assets/**",
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
      },
    },
  },
});
