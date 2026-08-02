import type { MenuItem, Permissions } from "../types/api";

/**
 * Menu rights decide what a user is OFFERED, not what they are allowed to do.
 *
 * Per backend/ROLES.md these are enforced on the sidebar only — the server does
 * not check them. The real gate is DataScope, which IS enforced. So this hides
 * navigation a user cannot use; it is not a security boundary and must never be
 * treated as one.
 *
 * Rights load at LOGIN and are cached, so a permission change needs a re-login
 * to take effect. Same as the web.
 */
export function visibleRoutes(permissions: Permissions | null): Set<string> {
  const rows: MenuItem[] = permissions?.rawPermissions ?? [];
  const routes = new Set<string>();
  for (const row of rows) {
    if (row?.permissions?.canView && row.route) routes.add(row.route);
  }
  return routes;
}

/** True when the user may see any one of the given routes. */
export const canSeeAny = (routes: Set<string>, wanted: string[]): boolean =>
  wanted.some((route) => routes.has(route));
