import { useEffect } from "react";
import { AppState } from "react-native";

import { heartbeat } from "../api/presenceQueries";
import useAuthStore from "../stores/useAuthStore";

/** The web's cadence (web/src/hooks/useHeartbeat.js): every 2 minutes while in use. */
export const HEARTBEAT_MS = 120_000;

/**
 * The app's ONE presence heartbeat (mounted in the Shell): a beat on
 * foreground, then every 2 minutes while active; nothing in the background.
 * Each answer records the session's expiry (G22). Paused while the re-sign-in
 * dialog is open — the closed session would only 401 — and the beat after it
 * lands at once. Errors are ignored: a dead session surfaces as its 401.
 */
export function useHeartbeat(): void {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const reauthOpen = useAuthStore((s) => Boolean(s.reauth));
  useEffect(() => {
    if (!isAuthenticated || reauthOpen) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const beat = () => {
      heartbeat()
        .then((r) => useAuthStore.getState().noteSessionExpiry(r.data?.expiresAt))
        .catch(() => {});
    };
    const start = () => {
      if (timer) return;
      beat();
      timer = setInterval(beat, HEARTBEAT_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    // Unknown (null) counts as active: a cold start in front.
    if (AppState.currentState !== "background" && AppState.currentState !== "inactive") start();
    const sub = AppState.addEventListener("change", (s) => (s === "active" ? start() : stop()));
    return () => {
      sub.remove();
      stop();
    };
  }, [isAuthenticated, reauthOpen]);
}
