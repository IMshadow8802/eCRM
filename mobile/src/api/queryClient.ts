// src/api/queryClient.ts
import { QueryClient } from "@tanstack/react-query";

// No realtime in Phase A (spec §5.2) — freshness comes from refetching when
// the app returns to the foreground, wired in App.tsx. staleTime is therefore
// short: the cache exists to make navigation instant, not to avoid refetching.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /**
       * One retry, not two. Each attempt can burn the full request timeout, so
       * `retry: 2` meant a screen could sit on a spinner for three timeouts
       * plus backoff — well over a minute — which reads as a frozen app rather
       * than a slow one. One retry covers the usual blip; past that the screen
       * should say so and offer a button.
       */
      retry: 1,
      retryDelay: 1000,
      /**
       * Never pause a query on React Query's own connectivity guess.
       *
       * The default `networkMode: "online"` defers to `onlineManager`, which
       * has no real signal on React Native unless NetInfo is wired into it —
       * and a wrong "offline" verdict leaves queries parked in `paused` with
       * nothing to un-park them, since there is no event coming either. Let
       * every request go out and let the transport decide; a genuinely offline
       * phone fails fast anyway.
       */
      networkMode: "always",
      staleTime: 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: 0, networkMode: "always" },
  },
});
