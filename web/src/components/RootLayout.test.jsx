import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

let mockIsAuthenticated = false;
vi.mock("../stores/useAuthStore", () => ({
  __esModule: true,
  default: (selector) => selector({ isAuthenticated: mockIsAuthenticated }),
}));

vi.mock("./TopNav", () => ({
  __esModule: true,
  default: ({ onOpenMobileSidebar }) => (
    <button data-testid="topnav" onClick={onOpenMobileSidebar}>
      topnav
    </button>
  ),
}));

vi.mock("./Sidebar", () => ({
  __esModule: true,
  default: ({ collapsed, mobileOpen, onToggleCollapsed, onMobileClose }) => (
    <div data-testid="sidebar" data-collapsed={collapsed} data-mobile-open={mobileOpen}>
      <button data-testid="toggle-collapsed" onClick={onToggleCollapsed} />
      <button data-testid="close-mobile" onClick={onMobileClose} />
    </div>
  ),
}));

vi.mock("../realtime/SocketProvider", () => ({
  __esModule: true,
  default: () => <div data-testid="socket-provider" />,
}));

import RootLayout from "./RootLayout";

const renderLayout = (path = "/dashboard") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <RootLayout>
        <div data-testid="page-content" />
      </RootLayout>
    </MemoryRouter>,
  );

describe("RootLayout", () => {
  beforeEach(() => {
    mockIsAuthenticated = false;
    localStorage.clear();
  });

  it("renders /login full-bleed: no sidebar, no topnav, no socket", () => {
    mockIsAuthenticated = true;
    renderLayout("/login");
    expect(screen.getByTestId("page-content")).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("topnav")).not.toBeInTheDocument();
    expect(screen.queryByTestId("socket-provider")).not.toBeInTheDocument();
  });

  it("mounts SocketProvider (and chrome) only when authenticated", () => {
    renderLayout();
    expect(screen.queryByTestId("socket-provider")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("topnav")).not.toBeInTheDocument();

    mockIsAuthenticated = true;
    renderLayout();
    expect(screen.getByTestId("socket-provider")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("topnav")).toBeInTheDocument();
  });

  it("toggles sidebar collapse and persists the choice", () => {
    mockIsAuthenticated = true;
    renderLayout();
    const sidebar = screen.getByTestId("sidebar");
    expect(sidebar).toHaveAttribute("data-collapsed", "false");
    fireEvent.click(screen.getByTestId("toggle-collapsed"));
    expect(sidebar).toHaveAttribute("data-collapsed", "true");
    expect(localStorage.getItem("sidebarCollapsed")).toBe("true");
  });

  it("respects a stored collapsed preference", () => {
    localStorage.setItem("sidebarCollapsed", "true");
    mockIsAuthenticated = true;
    renderLayout();
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "true");
  });

  it("opens the mobile sidebar from TopNav and closes it again", () => {
    mockIsAuthenticated = true;
    renderLayout();
    const sidebar = screen.getByTestId("sidebar");
    expect(sidebar).toHaveAttribute("data-mobile-open", "false");
    fireEvent.click(screen.getByTestId("topnav"));
    expect(sidebar).toHaveAttribute("data-mobile-open", "true");
    fireEvent.click(screen.getByTestId("close-mobile"));
    expect(sidebar).toHaveAttribute("data-mobile-open", "false");
  });
});
