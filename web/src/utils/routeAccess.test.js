import { describe, it, expect } from "vitest";

import {
  grantedRoutes,
  canAccessPath,
  firstAllowedPath,
  firstAllowedPathUnder,
} from "./routeAccess";

// Shape produced by authController.mapMenuRow and stored as
// useAuthStore.menuRights. sp_ValidateUser only returns CanView=1 rows.
const menu = (menuid, parentid, description, route, over = {}) => ({
  menuid,
  parentid,
  description,
  route,
  permissions: { canView: true, canAdd: false, canEdit: false, canDelete: false },
  ...over,
});

// What Vikas gets after 060_task_only_role.sql: one menu, nothing else.
const TASKS_ONLY = [menu(2, 0, "Tasks", "/tasks")];

// A sales user: the Sales parent plus two of its three children.
const SALES = [
  menu(14, 0, "Sales", "/sales"),
  menu(16, 14, "Leads", "/sales/leads"),
  menu(33, 14, "Follow-ups", "/sales/follow-ups"),
];

// Admin's children deliberately do NOT live under /admin.
const ADMIN = [
  menu(35, 0, "Admin", "/admin"),
  menu(36, 35, "Users", "/users"),
  menu(37, 35, "Teams", "/teams"),
];

describe("grantedRoutes", () => {
  it("lists the routes and strips trailing slashes", () => {
    expect(grantedRoutes([menu(2, 0, "Tasks", "/tasks/")])).toEqual(["/tasks"]);
  });

  it("ignores rows with no route and rows explicitly denied view", () => {
    const rights = [
      menu(2, 0, "Tasks", "/tasks"),
      menu(6, 0, "Legacy", null),
      menu(1, 0, "Dashboard", "/dashboard", {
        permissions: { canView: false },
      }),
    ];
    expect(grantedRoutes(rights)).toEqual(["/tasks"]);
  });

  it("survives null/empty rights", () => {
    expect(grantedRoutes(null)).toEqual([]);
    expect(grantedRoutes([])).toEqual([]);
  });
});

describe("canAccessPath", () => {
  it("allows a granted route", () => {
    expect(canAccessPath(TASKS_ONLY, "/tasks")).toBe(true);
  });

  // The whole point of this work: a Tasks-only user typing /dashboard.
  it("refuses a route the user was never granted", () => {
    expect(canAccessPath(TASKS_ONLY, "/dashboard")).toBe(false);
    expect(canAccessPath(TASKS_ONLY, "/sales/leads")).toBe(false);
    expect(canAccessPath(TASKS_ONLY, "/users")).toBe(false);
    expect(canAccessPath(TASKS_ONLY, "/groups")).toBe(false);
  });

  it("lets detail pages inherit from their list page", () => {
    // /sales/leads/42 has no menu row of its own.
    expect(canAccessPath(SALES, "/sales/leads/42")).toBe(true);
    expect(canAccessPath(TASKS_ONLY, "/tasks/anything/deep")).toBe(true);
  });

  it("does not treat a shared name prefix as a grant", () => {
    // /tasksecret must not match because /tasks was granted.
    expect(canAccessPath(TASKS_ONLY, "/tasksecret")).toBe(false);
  });

  it("tolerates a trailing slash on the requested path", () => {
    expect(canAccessPath(TASKS_ONLY, "/tasks/")).toBe(true);
  });

  it("always allows /login", () => {
    expect(canAccessPath([], "/login")).toBe(true);
  });

  it("refuses everything when the user has no menus", () => {
    expect(canAccessPath([], "/tasks")).toBe(false);
    expect(canAccessPath(null, "/dashboard")).toBe(false);
  });
});

describe("firstAllowedPath", () => {
  it("prefers a real child page over a section parent that only redirects", () => {
    expect(firstAllowedPath(SALES)).toBe("/sales/leads");
  });

  it("uses the parent path when it has no children", () => {
    expect(firstAllowedPath(TASKS_ONLY)).toBe("/tasks");
  });

  it("returns null when the user has no menus", () => {
    expect(firstAllowedPath([])).toBeNull();
    expect(firstAllowedPath(null)).toBeNull();
  });
});

describe("firstAllowedPathUnder", () => {
  it("finds the first granted child of a section", () => {
    expect(firstAllowedPathUnder(SALES, "/sales")).toBe("/sales/leads");
  });

  // Resolving by menu hierarchy, not string prefix — /admin's children are
  // /users and /teams, which share no path prefix with it.
  it("handles a section whose children live outside its path", () => {
    expect(firstAllowedPathUnder(ADMIN, "/admin")).toBe("/users");
  });

  it("falls back to a prefix scan when the parent menu is not granted", () => {
    const childrenOnly = [menu(16, 0, "Leads", "/sales/leads")];
    expect(firstAllowedPathUnder(childrenOnly, "/sales")).toBe("/sales/leads");
  });

  it("returns null when nothing in the section is granted", () => {
    expect(firstAllowedPathUnder(TASKS_ONLY, "/sales")).toBeNull();
  });
});
