import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  const isDev = command === "serve";

  console.log(`Building for: Web`);

  return {
    // Base path for web deployment
    base: "/prdcrm/",

    plugins: [react()],

    // React and emotion must each resolve to ONE instance. pnpm keeps two
    // physical copies of @emotion/react in the store (they differ only by a
    // build-time peer), and a second copy at runtime gives "You are loading
    // @emotion/react when it is already loaded", then "Invalid hook call"
    // once two Reacts meet. Deduping costs nothing and removes the class of
    // failure. (A mid-session dep re-optimisation is the other way to get
    // there: the open tab ends up holding modules from two optimise runs, and
    // the cure for that one is a hard reload.)
    resolve: {
      dedupe: ["react", "react-dom", "@emotion/react", "@emotion/styled"],
    },

    build: {
      // Output to dist-web directory
      outDir: "dist-web",
      assetsDir: "assets",
      rollupOptions: {
        output: {
          manualChunks: undefined,
        },
      },
    },

    server: {
      port: 8080,
      open: "/",
      // No API proxy: dev talks to the hosted backend that Central resolves
      // for the typed company code, exactly like prod (2026-09-16). The
      // backend's CORS allowlist includes http://localhost:8080 for this.
      // ADD THIS 👇 - This fixes SPA routing in development
      historyApiFallback: {
        index: "/index.html",
        rewrites: [{ from: /^\/prdcrm\/.*$/, to: "/index.html" }],
      },
    },

    // This fixes SPA routing in preview mode
    preview: {
      port: 4173,
      historyApiFallback: {
        index: "/index.html",
        rewrites: [{ from: /^\/prdcrm\/.*$/, to: "/index.html" }],
      },
    },
  };
});
