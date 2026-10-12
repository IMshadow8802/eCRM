import useAuthStore from "../stores/useAuthStore";
import { fetchMyAccess } from "../api/masterQueries";

// Re-read the signed-in user's access + menu rights into the store, so the
// sidebar and route gates follow an admin's change without a sign-out.
// Triggers: every page load (ProtectedRoute), window focus (at most once a
// minute), and the realtime `access` scope (`force`, bypasses the throttle).
// A failure is ignored: the 401 interceptor already handles an expired session.
const REFRESH_MS = 60_000;

// Module-level: every route mounts its own ProtectedRoute, so per-component
// state would reset on each navigation and defeat the throttle.
let lastRefresh = 0;
let loadedThisPage = false;
export const resetRefreshThrottle = () => { lastRefresh = 0; loadedThisPage = false; };

/** True the first time it is asked in this page load, false after. */
export const firstLoad = () => {
  if (loadedThisPage) return false;
  loadedThisPage = true;
  return true;
};

export async function refreshAccess({ force = false } = {}) {
  // A null access (a session saved before access existed) always refreshes.
  const missing = !useAuthStore.getState().access;
  if (!force && !missing && Date.now() - lastRefresh < REFRESH_MS) return;
  lastRefresh = Date.now();
  try {
    const res = await fetchMyAccess();
    const data = res?.data?.data;
    const { setAccess, setMenuRights } = useAuthStore.getState();
    if (data?.access) setAccess(data.access);
    if (data?.permissions?.rawPermissions) setMenuRights(data.permissions.rawPermissions);
  } catch {
    // see above
  }
}
