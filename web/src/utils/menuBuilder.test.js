import { describe, it, expect } from "vitest";
import {
  DashboardOutlined,
  TaskAltOutlined,
  AssignmentIndOutlined,
  FolderOpenOutlined,
  GroupsOutlined,
  PersonOutlineOutlined,
  SettingsOutlined,
  AssessmentOutlined,
  EventAvailableOutlined,
  ViewKanbanOutlined,
  LabelOutlined,
  SourceOutlined,
  ContactPhoneOutlined,
  AdminPanelSettingsOutlined,
  TrendingUpOutlined,
  CircleOutlined,
  SupportAgentOutlined,
  ConfirmationNumberOutlined,
  AccountTreeOutlined,
  DoneAllOutlined,
  CategoryOutlined,
  FlagOutlined,
  PhoneOutlined,
  TuneOutlined,
  ListAltOutlined,
  TimelineOutlined,
  TrendingDownOutlined,
  SwapHorizOutlined,
  Inventory2Outlined,
  EmojiEventsOutlined,
  PersonSearchOutlined,
  PeopleOutlined,
  RequestQuoteOutlined,
} from "@mui/icons-material";
import { getMenuIcon, menuPath, buildDynamicMenu, menuTrail, isMenuPathActive } from "./menuBuilder";

describe("getMenuIcon", () => {
  it.each([
    ["Dashboard", DashboardOutlined],
    ["Tasks", TaskAltOutlined],
    ["My Work", AssignmentIndOutlined],
    ["Projects", FolderOpenOutlined],
    ["Teams", GroupsOutlined],
    ["User Groups", AdminPanelSettingsOutlined],
    ["Users", PersonOutlineOutlined],
    ["Kanban Columns", ViewKanbanOutlined],
    ["Status", LabelOutlined],
    ["Lead Source", SourceOutlined],
    ["Leads", PersonSearchOutlined],
    ["Follow Ups", EventAvailableOutlined],
    ["Contacts", ContactPhoneOutlined],
    ["Reports", AssessmentOutlined],
    ["Master Data", SettingsOutlined],
    ["Settings", SettingsOutlined],
    ["Sales", TrendingUpOutlined],
    // sales/support module — distinct icons, no more repeated circles
    ["Support", SupportAgentOutlined],
    ["Ticket Board", ConfirmationNumberOutlined],
    ["Tickets", ConfirmationNumberOutlined],
    ["Customers", PeopleOutlined],
    // 091 §10: the Quotations row under Sales.
    ["Quotations", RequestQuoteOutlined],
    ["Pipeline", AccountTreeOutlined],
    ["Resolution Summary", DoneAllOutlined],
    ["Ticket Categories", CategoryOutlined],
    ["Priorities", FlagOutlined],
    ["Calls per User", PhoneOutlined],
    ["Custom Fields", TuneOutlined],
    ["Lookups", ListAltOutlined],
    // spec 4a sidebar rows — these were the circles (tblMenu rows 21, 40-46)
    ["Activity", TimelineOutlined],
    ["Lost Analysis", TrendingDownOutlined],
    ["Transfers", SwapHorizOutlined],
    ["Products", Inventory2Outlined],
    ["Something Else", CircleOutlined],
    [undefined, CircleOutlined],
  ])("maps %s to the expected icon", (title, expected) => {
    expect(getMenuIcon(title)).toBe(expected);
  });
});

describe("getMenuIcon — sales report rows (122 §7)", () => {
  it.each([
    ["Team report", GroupsOutlined], ["Lead sources", SourceOutlined], ["Open leads", PersonSearchOutlined],
    ["Lost leads", TrendingDownOutlined], ["Won deals", EmojiEventsOutlined], ["Work Reports", AssessmentOutlined],
  ])("%s", (title, icon) => expect(getMenuIcon(title)).toBe(icon));
});

describe("menuPath", () => {
  it("slugifies a single-word title", () => {
    expect(menuPath("Dashboard")).toBe("/dashboard");
  });

  it("replaces spaces with underscores and lowercases", () => {
    expect(menuPath("Lead Source")).toBe("/lead_source");
  });

  it("handles empty/undefined title", () => {
    expect(menuPath()).toBe("/");
  });
});

describe("buildDynamicMenu", () => {
  it("returns [] for empty/undefined input", () => {
    expect(buildDynamicMenu([])).toEqual([]);
    expect(buildDynamicMenu(undefined)).toEqual([]);
  });

  it("builds top-level menus with nested submenus", () => {
    const rights = [
      { menuid: 1, parentid: 0, description: "Dashboard", permissions: { canView: true } },
      { menuid: 3, parentid: 0, description: "Reports", permissions: { canView: true } },
      { menuid: 4, parentid: 3, description: "Followups User-wise", permissions: { canView: true } },
    ];
    const menus = buildDynamicMenu(rights);
    expect(menus).toHaveLength(2);
    const reports = menus.find((m) => m.title === "Reports");
    expect(reports.submenus).toHaveLength(1);
    const child = reports.submenus[0];
    expect(child.title).toBe("Followups User-wise");
    expect(child.menuId).toBe(4);
    // "Followups User-wise" matches the "user" keyword before "follow" in
    // getMenuIcon's if-chain (order matters — first match wins).
    expect(child.icon).toBe(PersonOutlineOutlined);
    expect(child.permissions).toEqual({ canView: true });
    expect(child.path).toBe("/followups_user-wise");
    const dashboard = menus.find((m) => m.title === "Dashboard");
    expect(dashboard.submenus).toBeNull();
  });

  it("filters out hidden menu ids (Kanban Columns, id 6)", () => {
    const rights = [
      { menuid: 6, parentid: 0, description: "Kanban Columns", permissions: {} },
      { menuid: 1, parentid: 0, description: "Dashboard", permissions: {} },
    ];
    const menus = buildDynamicMenu(rights);
    expect(menus).toHaveLength(1);
    expect(menus[0].title).toBe("Dashboard");
  });

  it("treats a self-referencing parentid as a top-level menu", () => {
    const rights = [
      { menuid: 5, parentid: 5, description: "Self Parent", permissions: {} },
    ];
    const menus = buildDynamicMenu(rights);
    expect(menus).toHaveLength(1);
    expect(menus[0].title).toBe("Self Parent");
  });

  it("uses a row's Route for the path (nested SPA routes) over the title slug", () => {
    const rights = [
      { menuid: 17, parentid: 0, description: "Support", route: "/support", permissions: { canView: true } },
      { menuid: 47, parentid: 17, description: "Customers", route: "/support/customers", permissions: { canView: true } },
      // no route -> falls back to the title slug
      { menuid: 19, parentid: 17, description: "Tickets", permissions: { canView: true } },
    ];
    const support = buildDynamicMenu(rights).find((m) => m.title === "Support");
    expect(support.path).toBe("/support");
    expect(support.submenus.find((s) => s.title === "Customers").path).toBe("/support/customers");
    expect(support.submenus.find((s) => s.title === "Customers").icon).toBe(PeopleOutlined);
    expect(support.submenus.find((s) => s.title === "Tickets").path).toBe("/tickets");
  });

  it("orders parents and children by sortOrder (110), unranked last by id", () => {
    const rights = [
      { menuid: 1, parentid: 0, description: "Dashboard", sortOrder: 10 },
      { menuid: 2, parentid: 0, description: "Tasks", sortOrder: 30 },
      { menuid: 3, parentid: 0, description: "Today", sortOrder: 20 },
      { menuid: 11, parentid: 0, description: "Sales Reports", sortOrder: 80 },
      { menuid: 14, parentid: 0, description: "Sales", sortOrder: 50 },
      { menuid: 99, parentid: 0, description: "Unranked B", sortOrder: null },
      { menuid: 60, parentid: 0, description: "Unranked A" },
      { menuid: 20, parentid: 11, description: "Team report", sortOrder: 1 },
      { menuid: 21, parentid: 11, description: "Won deals", sortOrder: 5 },
      { menuid: 45, parentid: 11, description: "Open leads", sortOrder: 3 },
      { menuid: 70, parentid: 11, description: "New report" },
      { menuid: 22, parentid: 11, description: "Lead sources", sortOrder: 2 },
    ];
    const menus = buildDynamicMenu(rights);
    expect(menus.map((m) => m.title)).toEqual([
      "Dashboard", "Today", "Tasks", "Sales", "Sales Reports", "Unranked A", "Unranked B",
    ]);
    expect(menus.find((m) => m.menuId === 11).submenus.map((s) => s.title)).toEqual([
      "Team report", "Lead sources", "Open leads", "Won deals", "New report",
    ]);
  });

  it("keeps Id order when no row has a sortOrder (before 110 is applied)", () => {
    const rights = [
      { menuid: 49, parentid: 0, description: "My Work" },
      { menuid: 3, parentid: 0, description: "Today" },
      { menuid: 1, parentid: 0, description: "Dashboard" },
    ];
    expect(buildDynamicMenu(rights).map((m) => m.menuId)).toEqual([1, 3, 49]);
  });

describe("menuTrail / isMenuPathActive", () => {
  const menus = buildDynamicMenu([
    { menuid: 30, parentid: 0, description: "Team Reports", route: "/reports/team" },
    { menuid: 31, parentid: 30, description: "Task deadlines", route: "/reports/tat" },
    { menuid: 1, parentid: 0, description: "Leads", route: "/sales/leads" },
  ]);
  const at = (pathname, search = "") => ({ pathname, search });

  it("finds parent + child for a submenu page, the item for a top-level one", () => {
    expect(menuTrail(menus, at("/reports/tat")).map((m) => m.title)).toEqual(["Team Reports", "Task deadlines"]);
    expect(menuTrail(menus, at("/sales/leads/42")).map((m) => m.title)).toEqual(["Leads"]);
    expect(menuTrail(menus, at("/nowhere"))).toEqual([]);
  });

  it("matches the path exactly or as a prefix segment, never a partial word", () => {
    expect(isMenuPathActive("/reports/sales/team", at("/reports/sales/team"))).toBe(true);
    expect(isMenuPathActive("/reports/sales/team", at("/reports/sales/team/rows", "?metric=calls"))).toBe(true);
    expect(isMenuPathActive("/sales/lead", at("/sales/leads"))).toBe(false);
  });
});
});
