import { useEffect } from "react";
import { AppState } from "react-native";

import { heartbeat } from "../api/presenceQueries";
import useAuthStore from "../stores/useAuthStore";

/** The web's cadence (CLAUDE.md §3 Sessions): every 2 minutes while in use. */
export const HEARTBEAT_MS = 120_000;

/**
 * Keeps the server session alive while the app is in front and records the
 * expiry it answers with (G22: "session ends 7:00 pm" in More). A failed beat
 * is left to the api client: a closed session already surfaces as its 401.
 */
export function useHeartbeat(): void {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  useEffect(() => {
    if (!isAuthenticated) return;
    const beat = () => {
      // Not when backgrounded; an unknown state (cold start) still beats.
      if (AppState.currentState === "background" || AppState.currentState === "inactive") return;
      heartbeat()
        .then((r) => useAuthStore.getState().noteSessionExpiry(r.data?.expiresAt))
        .catch(() => {});
    };
    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") beat();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [isAuthenticated]);
}

export default useHeartbeat;
