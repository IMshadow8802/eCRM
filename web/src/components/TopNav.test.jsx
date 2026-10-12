import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
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
vi.mock("../utils/axiosConfig", () => ({
  __esModule: true,
  apiClient: { post: (...args) => mockApiPost(...args) },
}));

vi.mock("notistack", async () => {
  const actual = await vi.importActual("notistack");
  return { ...actual, useSnackbar: () => ({ enqueueSnackbar: vi.fn() }) };
});

vi.mock("../assets/profile.png", () => ({ default: "test-profile.png" }));

// Capture the routing callback so the notification-click behaviour can be
// exercised without rendering the real bell.
let capturedOnOpenEntity = null;
vi.mock("./Notifications/NotificationBell", () => ({
  __esModule: true,
  default: ({ onOpenEntity }) => {
    capturedOnOpenEntity = onOpenEntity;
    return null;
  },
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

import { ThemeProvider } from "@mui/material/styles";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import TopNav from "./TopNav";
import useAuthStore from "../stores/useAuthStore";
import { HeaderSlotContext } from "./ui/headerSlot";
import { buildTheme } from "../theme";
import { chrome } from "../styles/tokens";
import { rem } from "../utils/rem";
import { useSocketStatus } from "../realtime/SocketProvider";

const renderTopNav = (onOpenMobileSidebar = vi.fn(), route = "/dashboard") =>
  render(
    <ThemeProvider theme={buildTheme("light")}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[route]}>
          <TopNav onOpenMobileSidebar={onOpenMobileSidebar} />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>
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

  it("mounts the realtime status pill (hidden until first connect, Live after)", () => {
    renderTopNav();
    expect(screen.queryByTestId("socket-status")).not.toBeInTheDocument();
    act(() => useSocketStatus.setState({ status: "live" }));
    expect(screen.getByTestId("socket-status")).toHaveTextContent("Live");
    act(() => useSocketStatus.setState({ status: "idle" }));
  });

  it("shows a page title derived from the route", () => {
    renderTopNav();
    expect(screen.getByTestId("page-title")).toHaveTextContent("Dashboard");
  });

  it("renders the header slot the page portals into, setting it on the layout", () => {
    const setSlot = vi.fn();
    render(
      <ThemeProvider theme={buildTheme("light")}>
        <QueryClientProvider client={new QueryClient()}>
          <HeaderSlotContext.Provider value={{ slot: null, setSlot }}>
            <MemoryRouter initialEntries={["/dashboard"]}>
              <TopNav onOpenMobileSidebar={vi.fn()} />
            </MemoryRouter>
          </HeaderSlotContext.Provider>
        </QueryClientProvider>
      </ThemeProvider>,
    );
    expect(setSlot).toHaveBeenCalledWith(screen.getByTestId("header-slot"));
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
    expect(screen.getByText("My Account")).toBeInTheDocument();
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
    expect(screen.queryByText("My Account")).not.toBeInTheDocument();
  });

  // REGRESSION (audit 2026-10-12, W1): logout navigated in-app and kept the
  // React Query cache, so the next person on a shared PC was served the
  // previous user's leads and complaints from it.
  it("clears every cached query on logout", async () => {
    const clear = vi.spyOn(QueryClient.prototype, "clear");
    renderTopNav();
    fireEvent.click(screen.getByText("Super"));
    fireEvent.click(screen.getByText("Logout"));
    await new Promise((r) => setTimeout(r, 200));
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
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

  it("opens the My Account modal from the profile popover", () => {
    renderTopNav();
    fireEvent.click(screen.getByText("Super"));
    fireEvent.click(screen.getByTestId("open-account"));
    expect(screen.getByTestId("account-modal")).toBeInTheDocument();
  });

  it("still completes logout even if the API call rejects", async () => {
    mockApiPost = vi.fn().mockRejectedValue(new Error("network down"));
    renderTopNav();
    fireEvent.click(screen.getByText("Super"));
    fireEvent.click(screen.getByText("Logout"));
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByText("My Account")).not.toBeInTheDocument();
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

describe("TopNav notification routing", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    capturedOnOpenEntity = null;
  });

  it("opens a task notification on the board", () => {
    renderTopNav();
    capturedOnOpenEntity({ EntityType: "task", EntityId: 42 });
    expect(mockNavigate).toHaveBeenCalledWith("/tasks?taskId=42");
  });

  it("a comment notification (EntityType task) opens its task", () => {
    renderTopNav();
    capturedOnOpenEntity({ EntityType: "task", Type: "comment_added", EntityId: 42 });
    expect(mockNavigate).toHaveBeenCalledWith("/tasks?taskId=42");
  });

  // REGRESSION: workspace invites had no branch here at all, so clicking the
  // bell item did nothing and the invite could only be found by wandering onto
  // the Tasks page. Note the SPs emit EntityType 'Workspace' capitalised while
  // task/comment are lowercase — matching must be case-insensitive.
  it("sends a workspace invite to the board, where the switcher prompts it", () => {
    renderTopNav();
    capturedOnOpenEntity({ EntityType: "Workspace", EntityId: 10011 });
    expect(mockNavigate).toHaveBeenCalledWith("/tasks");
  });

  // Spec 2: escalation + assignment notifications carry EntityType 'ticket'.
  it("opens a ticket notification on the complaint's page", () => {
    renderTopNav();
    capturedOnOpenEntity({ EntityType: "ticket", EntityId: 7 });
    expect(mockNavigate).toHaveBeenCalledWith("/support/tickets/7");
  });

  it("a not-signed-in alert opens the team tab of Today", () => {
    renderTopNav();
    capturedOnOpenEntity({ EntityType: "user", Type: "presence_not_signed_in", EntityId: 5 });
    expect(mockNavigate).toHaveBeenCalledWith("/today?tab=team");
  });

  it("ignores a notification with no usable entity", () => {
    renderTopNav();
    capturedOnOpenEntity({ EntityType: "task" }); // no EntityId
    capturedOnOpenEntity({});
    capturedOnOpenEntity(null);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  describe("two rows: app chrome, then the page", () => {
    const base = useAuthStore.getMockImplementation();
    const withMenu = () =>
      useAuthStore.mockImplementation(() => ({
        user: { Id: 1, FullName: "Super", JobTitle: "Super Admin" },
        logout: vi.fn(),
        companyName: "PRD Infotech",
        menuRights: [
          { menuid: 30, parentid: 0, description: "Team Reports", route: "/reports/team" },
          { menuid: 31, parentid: 30, description: "Task deadlines", route: "/reports/tat" },
          { menuid: 1, parentid: 0, description: "Today", route: "/today" },
        ],
      }));
    afterEach(() => useAuthStore.mockImplementation(base));

    it("breadcrumbs the parent menu and titles the page from the menu", () => {
      withMenu();
      renderTopNav(vi.fn(), "/reports/tat");
      expect(screen.getByTestId("breadcrumb")).toHaveTextContent("DashboardTeam Reports");
      expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
      expect(screen.getByTestId("page-title")).toHaveTextContent("Task deadlines");
      expect(screen.getByTestId("page-row")).toContainElement(screen.getByTestId("header-slot"));
      expect(screen.getByTestId("app-context")).toHaveTextContent("PRD Infotech");
    });

    it("a top-level page reads Dashboard › page", () => {
      withMenu();
      renderTopNav(vi.fn(), "/today");
      expect(screen.getByTestId("breadcrumb")).toHaveTextContent(/^Dashboard$/);
      expect(screen.getByTestId("page-title")).toHaveTextContent("Today");
    });

    it("the Dashboard itself has no breadcrumb", () => {
      withMenu();
      renderTopNav(vi.fn(), "/dashboard");
      expect(screen.queryByTestId("breadcrumb")).not.toBeInTheDocument();
    });

    it("is flat at the top and casts a shadow once something scrolls under it", () => {
      const { container } = renderTopNav();
      const bar = container.querySelector("header");
      expect(bar.dataset.scrolled).toBe("false");
      const scroller = document.createElement("div");
      document.body.appendChild(scroller);
      Object.defineProperty(scroller, "scrollTop", { value: 40, configurable: true });
      act(() => { scroller.dispatchEvent(new Event("scroll")); });
      expect(bar.dataset.scrolled).toBe("true");
      Object.defineProperty(scroller, "scrollTop", { value: 0, configurable: true });
      act(() => { scroller.dispatchEvent(new Event("scroll")); });
      expect(bar.dataset.scrolled).toBe("false");
      scroller.remove();
    });

    it("row 1 is exactly chrome.row1 high, the sidebar header's height", () => {
      renderTopNav();
      expect(getComputedStyle(screen.getByTestId("topnav-row1")).height).toBe(rem(chrome.row1));
    });

    it("is attached: sticky at the very top, no floating margin or radius", () => {
      const { container } = renderTopNav();
      const cs = getComputedStyle(container.querySelector("header"));
      expect(cs.position).toBe("sticky");
      expect(cs.top).toBe("0px");
      expect(["0", "0px"]).toContain(cs.borderRadius);
    });
  });
});
