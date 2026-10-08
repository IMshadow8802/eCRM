import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";

import useAuthStore from "../stores/useAuthStore";
import { fetchMyAccess } from "../api/masterQueries";
import { canAccessPath } from "../utils/routeAccess";
import NoAccess from "../pages/NoAccess";

/**
 * Two gates, in order:
 *   1. Signed in at all? No -> /login.
 *   2. Do their menu rights grant this path? No -> the NoAccess page.
 *
 * Step 2 used to be missing entirely — this component only checked that a
 * userData key existed, so any authenticated user could type any URL and the
 * page rendered. Menu rights drew the sidebar and nothing else.
 *
 * This is a UX guard. The API still serves data to anyone with a valid token
 * regardless of menu rights, so this must not be mistaken for the security
 * boundary — that has to land server-side.
 *
 * Gate 1 reads the STORE, not `localStorage.userData`. It used to read the key
 * directly, which is not reactive: clearing the session updated every
 * subscriber — the layout dropped the nav, the store emptied — while this
 * guard kept rendering the page it had already decided to render, because
 * nothing told React to ask again. The guard and the UI could disagree about
 * whether anyone was signed in. `isAuthenticated` is persisted and rehydrates
 * synchronously with the rest of the store, so a reload still lands correctly.
 */
const REFRESH_MS = 60_000;

// Module-level, not a ref: every route mounts its own ProtectedRoute, so a ref
// would reset on each navigation and defeat the throttle.
let lastRefresh = 0;
export const resetRefreshThrottle = () => { lastRefresh = 0; };

const ProtectedRoute = ({ element }) => {
  const location = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const menuRights = useAuthStore((state) => state.menuRights);

  // Rights are read at login; an admin's change reaches a signed-in user the
  // next time the tab regains focus (at most once a minute). A failure is
  // ignored: the 401 interceptor already handles an expired session.
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const refresh = async () => {
      // A null access (a session saved before this shipped, or a reload) always
      // refreshes; otherwise at most once a minute.
      const missing = !useAuthStore.getState().access;
      if (!missing && Date.now() - lastRefresh < REFRESH_MS) return;
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
    };
    if (!useAuthStore.getState().access) refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!canAccessPath(menuRights, location.pathname)) {
    return <NoAccess />;
  }

  return element;
};

export default ProtectedRoute;
