import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

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
    ],
    setActiveMenuRights: vi.fn(),
  }));
  return { __esModule: true, default: fn };
});

import Sidebar from "./Sidebar";

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
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Sidebar {...props} />
      </MemoryRouter>
    ),
    props,
  };
};

describe("Sidebar", () => {
  beforeEach(() => {
    setMatchMedia({});
  });

  it("renders every top-level menu item", () => {
    renderSidebar();
    expect(screen.getByTestId("sidebar-Dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-Tasks")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-Reports")).toBeInTheDocument();
  });

  it("always renders the static Sales and Settings entries", () => {
    renderSidebar();
    expect(screen.getByTestId("sidebar-Sales")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-Settings")).toBeInTheDocument();
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
});
