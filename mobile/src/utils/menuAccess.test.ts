import type { MenuItem, Permissions } from "../types/api";
import { canSeeAny, visibleRoutes } from "./menuAccess";

const row = (route: string | null, canView: boolean) =>
  ({ route, permissions: { canView, canAdd: false, canEdit: false, canDelete: false } }) as MenuItem;

const perms = (rows: MenuItem[]): Permissions => ({
  menuItems: [],
  rawPermissions: rows,
  totalMenuItems: rows.length,
  hasAdminAccess: false,
});

it("offers only routes the role can view", () => {
  const routes = visibleRoutes(perms([row("/sales/leads", true), row("/support/complaints", false), row(null, true)]));
  expect([...routes]).toEqual(["/sales/leads"]);
});

it("offers nothing without permissions or rows", () => {
  expect(visibleRoutes(null).size).toBe(0);
  expect(visibleRoutes({ ...perms([]), rawPermissions: undefined as unknown as MenuItem[] }).size).toBe(0);
  expect(visibleRoutes(perms([null as unknown as MenuItem])).size).toBe(0);
});

it("canSeeAny is true when any one wanted route is visible", () => {
  const routes = new Set(["/sales/leads"]);
  expect(canSeeAny(routes, ["/support/complaints", "/sales/leads"])).toBe(true);
  expect(canSeeAny(routes, ["/support/complaints"])).toBe(false);
  expect(canSeeAny(routes, [])).toBe(false);
});
