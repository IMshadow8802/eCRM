import React, { useEffect, useMemo } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { buildTheme } from "./theme";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { LocalizationProvider } from "@mui/x-date-pickers";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import useThemeStore from "./stores/useThemeStore";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true, // tab focus = cheap catch-up for missed realtime events
      retry: 1,
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnReconnect: true,
      networkMode: "online",
    },
    mutations: {
      // NEVER retry mutations: POSTs here are not idempotent. A retried
      // "failure" that actually committed server-side double-creates records
      // and surfaces phantom 409s (an accepted invite got re-accepted by the
      // retry and errored while the DB was already updated).
      retry: 0,
      networkMode: "online",
    },
  },
});

function ThemedApp() {
  const mode = useThemeStore((s) => s.mode);
  const syncWithSystem = useThemeStore((s) => s.syncWithSystem);
  const theme = useMemo(() => buildTheme(mode), [mode]);

  useEffect(() => {
    // Hydrate html.dark class + listen for system-preference changes
    // (noop once user overrides via the toggle)
    const unsub = syncWithSystem?.();
    return () => unsub && unsub();
  }, [syncWithSystem]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <App />
      </LocalizationProvider>
    </ThemeProvider>
  );
}

const container = document.getElementById("root");
// Reuse the root across HMR reloads — createRoot() twice on the same node errors.
const root = (container._reactRoot ??= ReactDOM.createRoot(container));
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemedApp />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </React.StrictMode>
);
