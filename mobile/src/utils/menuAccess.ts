import type { MenuItem, Permissions } from "../types/api";

/**
 * Menu rights decide what a user is OFFERED, not what they are allowed to do.
 *
 * Menu rights come from the role's module grants. The server enforces those
 * same grants on every route (spec 2026-10-07), so this only hides what the
 * server would refuse.
 *
 * Mobile loads rights at login and does not refresh them, so a role change
 * needs a re-login here (the web refreshes on focus).
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
