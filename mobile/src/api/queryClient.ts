// src/api/queryClient.ts
import { QueryClient } from "@tanstack/react-query";

// No realtime in Phase A (spec §5.2) — freshness comes from refetching when
// the app returns to the foreground, wired in App.tsx. staleTime is therefore
// short: the cache exists to make navigation instant, not to avoid refetching.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: 0 },
  },
});
