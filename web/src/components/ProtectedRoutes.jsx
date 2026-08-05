import { Navigate, useLocation } from "react-router-dom";

import useAuthStore from "../stores/useAuthStore";
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
const ProtectedRoute = ({ element }) => {
  const location = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const menuRights = useAuthStore((state) => state.menuRights);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!canAccessPath(menuRights, location.pathname)) {
    return <NoAccess />;
  }

  return element;
};

export default ProtectedRoute;
