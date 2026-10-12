import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

let mockIsAuthenticated = false;
vi.mock("../stores/useAuthStore", () => ({
  __esModule: true,
  default: (selector) => selector({ isAuthenticated: mockIsAuthenticated }),
}));

vi.mock("./TopNav", async () => {
  // The stub still hosts the header slot, as the real bar does.
  const { useHeaderSlot } = await import("./ui/headerSlot");
  function TopNavStub({ onOpenMobileSidebar }) {
    const { setSlot } = useHeaderSlot();
    return (
      <>
        <button data-testid="topnav" onClick={onOpenMobileSidebar}>
          topnav
        </button>
        <div ref={setSlot} data-testid="topnav-slot" />
      </>
    );
  }
  return { __esModule: true, default: TopNavStub };
});

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

vi.mock("./ReauthDialog", () => ({ __esModule: true, default: () => <div data-testid="reauth" /> }));
vi.mock("./PresenceNoticeDialog", () => ({ __esModule: true, default: () => <div data-testid="notice" /> }));
const heartbeat = vi.fn();
vi.mock("../hooks/useHeartbeat", () => ({ __esModule: true, default: () => heartbeat() }));

import RootLayout from "./RootLayout";
import PageHeader from "./ui/PageHeader";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../theme";

const renderLayout = (path = "/dashboard", page = <div data-testid="page-content" />) =>
  render(
    <ThemeProvider theme={buildTheme("light")}>
      <MemoryRouter initialEntries={[path]}>
        <RootLayout>{page}</RootLayout>
      </MemoryRouter>
    </ThemeProvider>,
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

  it("mounts the session dialogs over the page when authenticated, and runs the heartbeat", () => {
    renderLayout();
    expect(screen.queryByTestId("reauth")).not.toBeInTheDocument();
    expect(screen.queryByTestId("notice")).not.toBeInTheDocument();
    expect(heartbeat).toHaveBeenCalled();

    mockIsAuthenticated = true;
    renderLayout();
    expect(screen.getByTestId("reauth")).toBeInTheDocument();
    expect(screen.getByTestId("notice")).toBeInTheDocument();
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

  it("a page's PageHeader lands in the top bar, not under it", () => {
    mockIsAuthenticated = true;
    renderLayout("/leads", <PageHeader title="Leads" actions={<button>New Lead</button>} />);
    const slot = screen.getByTestId("topnav-slot");
    expect(slot).toContainElement(screen.getByRole("heading", { level: 1, name: "Leads" }));
    expect(slot).toContainElement(screen.getByRole("button", { name: "New Lead" }));
    expect(screen.getByRole("main")).not.toHaveTextContent("Leads");
  });
});
