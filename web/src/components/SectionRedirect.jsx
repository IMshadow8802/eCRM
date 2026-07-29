import { Navigate } from "react-router-dom";

import useAuthStore from "../stores/useAuthStore";
import { firstAllowedPathUnder } from "../utils/routeAccess";

/**
 * Bare section paths (/sales, /support, /settings, /reports, /admin) have no
 * page of their own — the sidebar parent items navigate to them. Send the user
 * to the first child they are actually granted.
 *
 * `fallback` keeps the old fixed destination for the case where nothing in the
 * section is granted; it routes through ProtectedRoute, so they land on the
 * NoAccess page rather than a blank screen.
 */
export default function SectionRedirect({ prefix, fallback }) {
  const menuRights = useAuthStore((state) => state.menuRights);
  const target = firstAllowedPathUnder(menuRights, prefix) ?? fallback;
  return <Navigate to={target} replace />;
}
