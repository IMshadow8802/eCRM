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
    /**
     * Cap the worker pool.
     *
     * Vitest defaults to roughly one worker per core, and every worker builds
     * its own jsdom — a few hundred MB each. On a 12-core machine that is ~11
     * simultaneous DOM environments, which on this suite was enough to exhaust
     * memory and force a hard restart (twice, 2026-08-04/05, once while other
     * node processes were also running).
     *
     * Four is the compromise: the wall-clock difference on ~109 files is small
     * because the suite is dominated by transform and setup rather than by
     * parallelism, and the ceiling drops to something a laptop can hold
     * alongside a dev server and an editor.
     *
     * Both pools are set because which one applies depends on the pool Vitest
     * picks; the unused one is ignored rather than an error.
     *
     * Both BOUNDS are set, not just the max: the pool defaults its minimum to
     * the core count, so a lone `maxForks: 4` leaves min(12) > max(4) and the
     * pool refuses to start — reporting a bare "no tests" plus a stack trace in
     * createForksPool, which looks nothing like a config error.
     */
    poolOptions: {
      forks: { minForks: 1, maxForks: 4 },
      threads: { minThreads: 1, maxThreads: 4 },
    },
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
