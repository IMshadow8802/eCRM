// Route-level access checks driven by the user's menu rights.
//
// Menus are DB-driven: tblMenu.Route holds each menu's SPA path, and
// sp_ValidateUser returns only the rows the caller's group has CanView on. So
// "which routes may this user open" is answerable entirely from menuRights,
// which login already puts in useAuthStore.
//
// This is a UX guard, not a security boundary. It stops someone typing a URL
// they were never granted; it does not stop anyone calling the API directly,
// because menu rights are still not enforced server-side. Treat it as the
// first of two layers, never the only one.

import { buildDynamicMenu } from "./menuBuilder";

// Reachable without any menu grant.
const PUBLIC_PATHS = new Set(["/login"]);

// Trailing slashes would break the prefix comparison below ("/tasks/" never
// equals "/tasks"), so every path goes through this first.
const norm = (path) => {
  const trimmed = String(path || "").replace(/\/+$/, "");
  return trimmed || "/";
};

/**
 * Every route path the user's menu rights grant, normalised.
 *
 * sp_ValidateUser already filters to CanView = 1, so a row being present is
 * itself the grant; the canView check is belt-and-braces for callers that
 * hydrate menuRights from a different source. It tolerates a missing
 * permissions object on purpose — the failure mode of being too strict here is
 * locking a legitimate user out of the whole app.
 */
export function grantedRoutes(menuRights) {
  return (menuRights || [])
    .filter((m) => m?.route && m.permissions?.canView !== false)
    .map((m) => norm(m.route));
}

/**
 * May this user open this path?
 *
 * A granted route also covers its sub-paths, so detail pages that have no menu
 * row of their own (/sales/leads/42, /support/tickets/7) inherit from their
 * list page. Note this means granting a section parent (/sales) grants the
 * whole section — which matches how the Roles & Permissions screen cascades a
 * parent's CanView down to its children.
 */
export function canAccessPath(menuRights, pathname) {
  const path = norm(pathname);
  if (PUBLIC_PATHS.has(path)) return true;
  return grantedRoutes(menuRights).some(
    (route) => path === route || path.startsWith(`${route}/`),
  );
}

/**
 * Where to send someone who has just logged in, or who landed somewhere they
 * cannot see. Follows sidebar order and prefers a real page over a section
 * parent that only redirects. Null when they have no menus at all.
 */
export function firstAllowedPath(menuRights) {
  for (const item of buildDynamicMenu(menuRights)) {
    if (item.submenus?.length) return item.submenus[0].path;
    if (item.path) return item.path;
  }
  return null;
}

/**
 * First granted page inside a section, for the bare-section redirects
 * (/sales -> /sales/pipeline). Without this a user granted Leads but not
 * Pipeline would be bounced to a page they cannot see.
 *
 * Resolves through the menu tree rather than by string prefix, because not
 * every section's children live under its path: Admin is /admin but its
 * children are /users, /teams, /projects and /groups. Falls back to a prefix
 * scan for the case where the children are granted but the parent menu is not.
 */
export function firstAllowedPathUnder(menuRights, prefix) {
  const base = norm(prefix);

  const parent = buildDynamicMenu(menuRights).find(
    (item) => norm(item.path) === base,
  );
  if (parent?.submenus?.length) return parent.submenus[0].path;

  return (
    grantedRoutes(menuRights).find(
      (route) => route !== base && route.startsWith(`${base}/`),
    ) ?? null
  );
}
