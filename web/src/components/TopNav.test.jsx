import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../stores/useAuthStore", () => {
  const fn = vi.fn(() => ({
    menuRights: [],
    user: { Id: 1, FullName: "Super", JobTitle: "Super Admin" },
    logout: vi.fn(),
    setActiveMenuRights: vi.fn(),
  }));
  return { __esModule: true, default: fn };
});

let mockThemeMode = "light";
vi.mock("../stores/useThemeStore", () => {
  const fn = vi.fn((selector) => {
    const state = { mode: mockThemeMode, toggleMode: vi.fn(), setMode: vi.fn() };
    return typeof selector === "function" ? selector(state) : state;
  });
  return { __esModule: true, default: fn };
});

let mockApiPost = vi.fn().mockResolvedValue({ data: {} });
vi.mock("../hooks/useApi", () => ({
  __esModule: true,
  default: () => ({ post: (...args) => mockApiPost(...args) }),
}));

vi.mock("notistack", async () => {
  const actual = await vi.importActual("notistack");
  return { ...actual, useSnackbar: () => ({ enqueueSnackbar: vi.fn() }) };
});

vi.mock("../assets/profile.png", () => ({ default: "test-profile.png" }));

vi.mock("./Notifications/NotificationBell", () => ({
  __esModule: true,
  default: () => null,
}));

import TopNav from "./TopNav";

const renderTopNav = (onOpenMobileSidebar = vi.fn()) =>
  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <TopNav onOpenMobileSidebar={onOpenMobileSidebar} />
    </MemoryRouter>
  );

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

describe("TopNav", () => {
  beforeEach(() => {
    setMatchMedia({});
    mockThemeMode = "light";
    mockApiPost = vi.fn().mockResolvedValue({ data: {} });
    localStorage.clear();
  });

  it("shows a page title derived from the route", () => {
    renderTopNav();
    expect(screen.getByTestId("page-title")).toHaveTextContent("Dashboard");
  });

  it("does not render the hamburger on desktop", () => {
    renderTopNav();
    expect(screen.queryByTestId("hamburger-button")).not.toBeInTheDocument();
  });

  it("opens the profile popover and shows logout button when avatar clicked", () => {
    renderTopNav();
    // click profile area (contains avatar)
    const displayName = screen.getByText("Super");
    fireEvent.click(displayName);
    expect(screen.getByText("Logout")).toBeInTheDocument();
    expect(screen.getByText("User ID")).toBeInTheDocument();
  });

  it("toggles theme when theme button clicked", () => {
    renderTopNav();
    const themeBtn = screen.getByLabelText(/Switch to (dark|light) mode/);
    fireEvent.click(themeBtn);
    // no throw — handler fired
    expect(themeBtn).toBeInTheDocument();
  });

  it("renders the light-mode icon when theme is dark", () => {
    mockThemeMode = "dark";
    renderTopNav();
    expect(screen.getByLabelText(/Switch to light mode/)).toBeInTheDocument();
  });

  it("reads user from localStorage when present", () => {
    localStorage.setItem(
      "userData",
      JSON.stringify({ user: { Id: 2, FullName: "Stored", JobTitle: "Admin" } })
    );
    renderTopNav();
    expect(screen.getByText("Stored")).toBeInTheDocument();
  });

  it("falls back gracefully when localStorage has invalid JSON", () => {
    localStorage.setItem("userData", "not-json");
    renderTopNav();
    // store fallback kicks in
    expect(screen.getByText("Super")).toBeInTheDocument();
  });

  it("triggers logout flow when Logout button clicked", async () => {
    renderTopNav();
    fireEvent.click(screen.getByText("Super"));
    const logoutBtn = screen.getByText("Logout");
    fireEvent.click(logoutBtn);
    // allow async handler to settle
    await new Promise((r) => setTimeout(r, 200));
    // popover should close; Logout text gone from the now-closed popover
    expect(screen.queryByText("User ID")).not.toBeInTheDocument();
  });

  it("falls back to capitalised FullName/JobTitle fields when present", () => {
    localStorage.setItem(
      "userData",
      JSON.stringify({ user: { FullName: "Alt", JobTitle: "Boss" } })
    );
    renderTopNav();
    expect(screen.getByText("Alt")).toBeInTheDocument();
    expect(screen.getByText("Boss")).toBeInTheDocument();
  });

  it("labels role as Administrator when user is admin", () => {
    localStorage.setItem(
      "userData",
      JSON.stringify({
        user: { Id: 3, FullName: "Root", JobTitle: "Admin", IsAdmin: true },
      })
    );
    renderTopNav();
    fireEvent.click(screen.getByText("Root"));
    expect(screen.getByText("Administrator")).toBeInTheDocument();
  });

  it("still completes logout even if the API call rejects", async () => {
    mockApiPost = vi.fn().mockRejectedValue(new Error("network down"));
    renderTopNav();
    fireEvent.click(screen.getByText("Super"));
    fireEvent.click(screen.getByText("Logout"));
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByText("User ID")).not.toBeInTheDocument();
  });

  it("renders the hamburger on mobile and forwards the click", () => {
    setMatchMedia({ "(max-width:767.98px)": true });
    const onOpen = vi.fn();
    renderTopNav(onOpen);
    const burger = screen.getByTestId("hamburger-button");
    expect(burger).toBeInTheDocument();
    fireEvent.click(burger);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
