import { useState } from "react";

import { logout as logoutRequest } from "../../api/authQueries";
import useAuthStore from "../../stores/useAuthStore";

/**
 * Sign-out with its confirmation state, shared by every place that offers it.
 *
 * The server call is best-effort: the local session is cleared either way, so a
 * dead network can never strand someone in a signed-in state they cannot leave.
 */
export function useSignOut() {
  const clearSession = useAuthStore((s) => s.logout);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    try {
      await logoutRequest();
    } catch {
      // ignored on purpose — see above
    }
    setBusy(false);
    setConfirming(false);
    clearSession();
  };

  return { confirming, setConfirming, busy, signOut };
}
