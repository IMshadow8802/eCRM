import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

const setMatchMedia = (matchesByQuery) => {
  window.matchMedia = (query) => ({
    matches: !!matchesByQuery[query],
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
};

vi.mock("../stores/useAuthStore", () => {
  const fn = vi.fn(() => ({
    menuRights: [
      {
        menuid: 1,
        parentid: 0,
        description: "Dashboard",
        permissions: { canView: true },
      },
      {
        menuid: 2,
        parentid: 0,
        description: "Tasks",
        permissions: { canView: true },
      },
      {
        menuid: 3,
        parentid: 0,
        description: "Reports",
        permissions: { canView: true },
      },
      {
        menuid: 4,
        parentid: 3,
        description: "Followups User-wise",
        permissions: { canView: true },
      },
      // DB-driven Sales Reports menu with explicit nested Routes (tblMenu.Route, 122 §7).
      {
        menuid: 20,
        parentid: 0,
        description: "Sales Reports",
        route: "/reports",
        permissions: { canView: true },
      },
      {
        menuid: 21,
        parentid: 20,
        description: "Team report",
        route: "/reports/sales/team",
        permissions: { canView: true },
      },
      {
        menuid: 22,
        parentid: 20,
        description: "Lead sources",
        route: "/reports/sales/sources",
        permissions: { canView: true },
      },
      {
        menuid: 23,
        parentid: 20,
        description: "Open leads",
        route: "/reports/sales/open",
        permissions: { canView: true },
      },
      {
        menuid: 24,
        parentid: 20,
        description: "Lost leads",
        route: "/reports/sales/lost",
        permissions: { canView: true },
      },
      {
        menuid: 25,
        parentid: 20,
        description: "Won deals",
        route: "/reports/sales/won",
        permissions: { canView: true },
      },
    ],
    setActiveMenuRights: vi.fn(),
  }));
  return { __esModule: true, default: fn };
});

import Sidebar from "./Sidebar";
import { chrome } from "../styles/tokens";
import { rem } from "../utils/rem";

const renderSidebar = (overrides = {}) => {
  const props = {
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    mobileOpen: false,
    onMobileClose: vi.fn(),
    ...overrides,
  };
  return {
    ...render(
      <MemoryRouter initialEntries={[overrides.route ?? "/dashboard"]}>
        <Sidebar {...props} />
      </MemoryRouter>
    ),
    props,
  };
};

describe("Sidebar", () => {
  beforeEach(() => {
    setMatchMedia({});
    mockNavigate.mockClear();
  });

  it("renders every top-level menu item", () => {
    renderSidebar();
    expect(screen.getByTestId("sidebar-Dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-Tasks")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-Reports")).toBeInTheDocument();
  });

  it("highlights the report row on its own page and on the rows behind it, nothing else", async () => {
    const user = userEvent.setup();
    renderSidebar({ route: "/reports/sales/team/rows?metric=calls" });
    await user.click(screen.getByTestId("sidebar-Sales Reports"));
    expect(screen.getByTestId("sidebar-Team report")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("sidebar-Lost leads")).not.toHaveAttribute("aria-current");
  });

  it("renders the DB-driven Sales Reports menu (from menuRights, not hardcoded)", () => {
    renderSidebar();
    expect(screen.getByTestId("sidebar-Sales Reports")).toBeInTheDocument();
  });

  it("navigates to a submenu's DB Route when clicked", () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId("sidebar-Sales Reports")); // expand parent
    fireEvent.click(screen.getByTestId("sidebar-Won deals"));
    expect(mockNavigate).toHaveBeenCalledWith("/reports/sales/won");
  });

  it("shows the collapse toggle on desktop and calls the handler on click", () => {
    const onToggleCollapsed = vi.fn();
    renderSidebar({ onToggleCollapsed });
    const toggle = screen.getByTestId("sidebar-toggle");
    expect(toggle).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it("places the collapse toggle at the top (before the menu list)", () => {
    renderSidebar();
    const toggle = screen.getByTestId("sidebar-toggle");
    const firstMenu = screen.getByTestId("sidebar-Dashboard");
    // DOCUMENT_POSITION_FOLLOWING = 4 — firstMenu comes AFTER toggle
    expect(toggle.compareDocumentPosition(firstMenu) & 4).toBeTruthy();
  });

  it("renders only one collapse toggle (no duplicate at the bottom)", () => {
    renderSidebar();
    expect(screen.getAllByTestId("sidebar-toggle")).toHaveLength(1);
  });

  it("hides the collapse toggle on mobile (drawer is temporary)", () => {
    setMatchMedia({ "(max-width:767.98px)": true });
    renderSidebar({ mobileOpen: true });
    expect(screen.queryByTestId("sidebar-toggle")).not.toBeInTheDocument();
  });

  it("renders the expand icon when collapsed on desktop", () => {
    renderSidebar({ collapsed: true });
    const toggle = screen.getByTestId("sidebar-toggle");
    expect(toggle.querySelector("svg")).toBeInTheDocument();
    // brand text hidden in collapsed mode
    expect(screen.queryByText("CRM")).not.toBeInTheDocument();
  });

  it("opens a flyout menu when clicking a parent with children in collapsed mode", () => {
    renderSidebar({ collapsed: true });
    fireEvent.click(screen.getByTestId("sidebar-Reports"));
    // flyout child should appear
    expect(screen.getByText("Followups User-wise")).toBeInTheDocument();
  });

  it("navigates when flyout parent header is clicked in collapsed mode", () => {
    renderSidebar({ collapsed: true });
    fireEvent.click(screen.getByTestId("sidebar-Reports"));
    // the flyout renders the parent title as a MenuItem too
    const parentHeaders = screen.getAllByText("Reports");
    // click the flyout copy (last one)
    fireEvent.click(parentHeaders[parentHeaders.length - 1]);
    // flyout closed → child no longer visible
    expect(
      screen.queryByText("Followups User-wise")
    ).not.toBeInTheDocument();
  });

  it("navigates when flyout child is clicked in collapsed mode", () => {
    renderSidebar({ collapsed: true });
    fireEvent.click(screen.getByTestId("sidebar-Reports"));
    fireEvent.click(screen.getByText("Followups User-wise"));
    expect(
      screen.queryByText("Followups User-wise")
    ).not.toBeInTheDocument();
  });

  it("expands a parent menu inline when it has children and is clicked in expanded mode", () => {
    renderSidebar();
    // Child is not visible until the parent is expanded
    expect(
      screen.queryByTestId("sidebar-Followups User-wise")
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("sidebar-Reports"));
    expect(
      screen.getByTestId("sidebar-Followups User-wise")
    ).toBeInTheDocument();
  });

  // Reported from a phone, 2026-09-19: the drawer had rounded corners on the
  // two edges that sit against the screen edge, so it read as a panel with a
  // 16px notch cut out of it rather than a drawer. theme.js puts
  // `borderRadius: radii.lg` on EVERY MuiPaper root, and the drawer's paper is
  // a Paper like any other — nothing in Sidebar had asked for the radius.
  it("squares the mobile drawer against the screen edge", () => {
    setMatchMedia({ "(max-width:767.98px)": true });
    const { container } = renderSidebar({ mobileOpen: true });
    const paper = container.ownerDocument.querySelector(".MuiDrawer-paper");
    expect(paper).toBeTruthy();
    // Explicitly not `parseFloat(...) || 0` — that also passes when the
    // property is absent, so it could never fail.
    expect(["0", "0px"]).toContain(getComputedStyle(paper).borderRadius);
  });

  it("squares the permanent drawer too", () => {
    setMatchMedia({});
    const { container } = renderSidebar();
    const paper = container.ownerDocument.querySelector(".MuiDrawer-paper");
    expect(paper).toBeTruthy();
    // Explicitly not `parseFloat(...) || 0` — that also passes when the
    // property is absent, so it could never fail.
    expect(["0", "0px"]).toContain(getComputedStyle(paper).borderRadius);
  });

  // The brand header's divider must continue the top bar's row-1 hairline:
  // both heights come from one token (chrome.row1), expanded or collapsed.
  it.each([false, true])("brand header is exactly the bar's row-1 height (collapsed=%s)", (collapsed) => {
    renderSidebar({ collapsed });
    expect(getComputedStyle(screen.getByTestId("sidebar-brand")).height).toBe(rem(chrome.row1));
  });
});
