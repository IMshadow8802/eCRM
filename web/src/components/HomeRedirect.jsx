import { Navigate } from "react-router-dom";

import useAuthStore from "../stores/useAuthStore";
import { firstAllowedPath } from "../utils/routeAccess";
import NoAccess from "../pages/NoAccess";

/**
 * "/" sends the user to the first page their menu rights grant.
 *
 * Was a hardcoded <Navigate to="/dashboard">, which landed everyone on
 * Dashboard whether or not they had it — the thing that made a Tasks-only user
 * open straight onto a page missing from their own sidebar.
 */
export default function HomeRedirect() {
  const menuRights = useAuthStore((state) => state.menuRights);

  if (!localStorage.getItem("userData")) {
    return <Navigate to="/login" replace />;
  }

  const home = firstAllowedPath(menuRights);
  // No menus at all is a provisioning mistake, not a routing one — say so
  // rather than bouncing them around.
  return home ? <Navigate to={home} replace /> : <NoAccess />;
}
