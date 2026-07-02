import { describe, it, expect } from "vitest";
import {
  DashboardOutlined,
  TaskAltOutlined,
  FolderOpenOutlined,
  GroupsOutlined,
  PersonOutlineOutlined,
  SettingsOutlined,
  AssessmentOutlined,
  LeaderboardOutlined,
  EventAvailableOutlined,
  ViewKanbanOutlined,
  LabelOutlined,
  SourceOutlined,
  ContactPhoneOutlined,
  AdminPanelSettingsOutlined,
  TrendingUpOutlined,
  CircleOutlined,
} from "@mui/icons-material";
import { getMenuIcon, menuPath, buildDynamicMenu } from "./menuBuilder";

describe("getMenuIcon", () => {
  it.each([
    ["Dashboard", DashboardOutlined],
    ["Tasks", TaskAltOutlined],
    ["Projects", FolderOpenOutlined],
    ["Teams", GroupsOutlined],
    ["User Groups", AdminPanelSettingsOutlined],
    ["Users", PersonOutlineOutlined],
    ["Kanban Columns", ViewKanbanOutlined],
    ["Status", LabelOutlined],
    ["Lead Source", SourceOutlined],
    ["Leads", LeaderboardOutlined],
    ["Follow Ups", EventAvailableOutlined],
    ["Contacts", ContactPhoneOutlined],
    ["Reports", AssessmentOutlined],
    ["Master Data", SettingsOutlined],
    ["Settings", SettingsOutlined],
    ["Sales", TrendingUpOutlined],
    ["Something Else", CircleOutlined],
    [undefined, CircleOutlined],
  ])("maps %s to the expected icon", (title, expected) => {
    expect(getMenuIcon(title)).toBe(expected);
  });
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
});
