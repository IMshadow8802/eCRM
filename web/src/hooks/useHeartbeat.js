import { useEffect } from "react";

import useAuthStore from "../stores/useAuthStore";
import { heartbeat } from "../api/presenceQueries";

export const HEARTBEAT_MS = 120000;

/**
 * Keeps the server session's last-seen fresh (spec P2: every 2 min while the
 * app is open — "open" meaning the tab is visible). Errors are ignored: a 401
 * is the interceptor's business, anything else just waits for the next beat.
 * Paused while a re-sign-in is open; the beat after it lands is immediate.
 */
export default function useHeartbeat() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const reauthOpen = useAuthStore((s) => Boolean(s.reauth));

  useEffect(() => {
    if (!isAuthenticated || reauthOpen) return undefined;
    const beat = () => {
      if (document.visibilityState === "visible") heartbeat().catch(() => {});
    };
    beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [isAuthenticated, reauthOpen]);
}
