import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  const isDev = command === "serve";

  console.log(`Building for: Web`);

  return {
    // Base path for web deployment
    base: "/prdcrm/",

    plugins: [react()],

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
      // Proxy API calls to local backend during development.
      // Frontend issues relative requests like `/api/auth/loginUser`
      // (see utils/axiosConfig.js: baseURL is empty in dev) and Vite
      // forwards them to the Express server.
      proxy: {
        "/api": {
          target: "http://localhost:5001",
          changeOrigin: true,
        },
        // Realtime websocket — SocketProvider connects to the window origin
        // in dev and this forwards the handshake + ws upgrade to Express.
        "/socket.io": {
          target: "http://localhost:5001",
          changeOrigin: true,
          ws: true,
        },
      },
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
