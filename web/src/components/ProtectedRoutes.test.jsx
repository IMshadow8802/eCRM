import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";

import renderWithProviders from "../test/renderWithProviders";
import ProtectedRoute, { resetRefreshThrottle } from "./ProtectedRoutes";
import useAuthStore from "../stores/useAuthStore";

vi.mock("../api/masterQueries", () => ({ fetchMyAccess: vi.fn() }));
import { fetchMyAccess } from "../api/masterQueries";

const menu = (menuid, parentid, description, route) => ({
  menuid,
  parentid,
  description,
  route,
  permissions: { canView: true, canAdd: false, canEdit: false, canDelete: false },
});

const TASKS_ONLY = [menu(2, 0, "Tasks", "/tasks")];

const Page = () => <div data-testid="the-page">secret page</div>;
const LoginPage = () => <div data-testid="login-page">login</div>;

const setRights = (rights) =>
  act(() => useAuthStore.setState({ menuRights: rights }));

const setSignedIn = (value) =>
  act(() => useAuthStore.setState({ isAuthenticated: value }));

beforeEach(() => {
  setSignedIn(true);
  setRights(TASKS_ONLY);
});

afterEach(() => {
  cleanup(); // unmount before clearing auth, else guards re-render mid-teardown
  localStorage.clear();
  setSignedIn(false);
  setRights([]);
});

describe("ProtectedRoute", () => {
  it("sends a signed-out visitor to login", () => {
    setSignedIn(false);
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/tasks" element={<ProtectedRoute element={<Page />} />} />
      </Routes>,
      { route: "/tasks" },
    );
    expect(screen.getByTestId("login-page")).toBeInTheDocument();
    expect(screen.queryByTestId("the-page")).not.toBeInTheDocument();
  });

  it("renders a page the user is granted", () => {
    renderWithProviders(
      <Routes>
        <Route path="/tasks" element={<ProtectedRoute element={<Page />} />} />
      </Routes>,
      { route: "/tasks" },
    );
    expect(screen.getByTestId("the-page")).toBeInTheDocument();
  });

  // REGRESSION: this component used to check only that a userData key existed,
  // so any authenticated user could type any URL and the page rendered. Menu
  // rights drew the sidebar and nothing else.
  it("blocks a page the user is NOT granted, without redirecting away", () => {
    renderWithProviders(
      <Routes>
        <Route
          path="/dashboard"
          element={<ProtectedRoute element={<Page />} />}
        />
      </Routes>,
      { route: "/dashboard" },
    );
    expect(screen.getByTestId("no-access")).toBeInTheDocument();
    expect(screen.queryByTestId("the-page")).not.toBeInTheDocument();
    // Explicit, not silent: the message names the refused path.
    expect(screen.getByText(/don't have access to this page/i)).toBeInTheDocument();
    expect(screen.getByText(/\/dashboard/)).toBeInTheDocument();
  });

  it("lets a detail page inherit the grant from its list page", () => {
    setRights([menu(16, 0, "Leads", "/sales/leads")]);
    renderWithProviders(
      <Routes>
        <Route
          path="/sales/leads/:leadId"
          element={<ProtectedRoute element={<Page />} />}
        />
      </Routes>,
      { route: "/sales/leads/42" },
    );
    expect(screen.getByTestId("the-page")).toBeInTheDocument();
  });

  /**
   * REGRESSION: the gate read `localStorage.getItem("userData")` directly,
   * which React cannot subscribe to. Ending a session cleared the store — the
   * layout dropped its nav, every subscriber re-rendered — while this guard
   * went on rendering the protected page, because nothing told it to look
   * again. Reading the store is what keeps the guard and the UI agreeing.
   */
  it("stops rendering the page the moment the session is cleared", () => {
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/tasks" element={<ProtectedRoute element={<Page />} />} />
      </Routes>,
      { route: "/tasks" },
    );
    expect(screen.getByTestId("the-page")).toBeInTheDocument();

    act(() => useAuthStore.getState().logout());

    expect(screen.queryByTestId("the-page")).not.toBeInTheDocument();
    expect(screen.getByTestId("login-page")).toBeInTheDocument();
  });

  it("blocks everything when the user has no menus at all", () => {
    setRights([]);
    renderWithProviders(
      <Routes>
        <Route path="/tasks" element={<ProtectedRoute element={<Page />} />} />
      </Routes>,
      { route: "/tasks" },
    );
    expect(screen.getByTestId("no-access")).toBeInTheDocument();
    // No home to offer, so no button — just the provisioning message.
    expect(screen.queryByTestId("no-access-home")).not.toBeInTheDocument();
    expect(screen.getByText(/no other pages assigned/i)).toBeInTheDocument();
  });
});

describe("ProtectedRoute focus refresh", () => {
  const mount = () =>
    renderWithProviders(
      <Routes><Route path="/tasks" element={<ProtectedRoute element={<Page />} />} /></Routes>,
      { route: "/tasks" },
    );
  const focus = () => act(async () => { window.dispatchEvent(new Event("focus")); });

  beforeEach(() => {
    fetchMyAccess.mockReset();
    resetRefreshThrottle();
    useAuthStore.setState({ access: { isAdmin: false, modules: {} } });
  });

  it("refreshes once on mount when access is null, with no focus event", async () => {
    useAuthStore.setState({ access: null });
    fetchMyAccess.mockResolvedValue({ data: { data: { access: { isAdmin: true, modules: {} } } } });
    await act(async () => { mount(); });
    expect(fetchMyAccess).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().access).toEqual({ isAdmin: true, modules: {} });
  });

  it("does not refresh on mount when access is already held", async () => {
    await act(async () => { mount(); });
    expect(fetchMyAccess).not.toHaveBeenCalled();
  });

  it("the throttle survives a remount (navigation), but null access bypasses it", async () => {
    fetchMyAccess.mockResolvedValue({ data: { data: {} } });
    const first = mount();
    await focus();
    first.unmount();
    mount();
    await focus();
    expect(fetchMyAccess).toHaveBeenCalledTimes(1);
    useAuthStore.setState({ access: null });
    await focus();
    expect(fetchMyAccess).toHaveBeenCalledTimes(2);
  });

  it("re-reads access and menu rights on focus, at most once a minute", async () => {
    const rights = [menu(2, 0, "Tasks", "/tasks"), menu(3, 0, "Leads", "/leads")];
    fetchMyAccess.mockResolvedValue({ data: { data: { access: { isAdmin: false, modules: {} }, permissions: { rawPermissions: rights } } } });
    mount();
    await focus();
    expect(fetchMyAccess).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().access).toEqual({ isAdmin: false, modules: {} });
    expect(useAuthStore.getState().menuRights).toEqual(rights);
    await focus();
    expect(fetchMyAccess).toHaveBeenCalledTimes(1);
  });

  it("ignores a failed refresh and a payload without access", async () => {
    fetchMyAccess.mockRejectedValueOnce(new Error("offline"));
    mount();
    await focus();
    expect(screen.getByTestId("the-page")).toBeInTheDocument();
    expect(fetchMyAccess).toHaveBeenCalledTimes(1);
  });

  it("does not call when signed out", async () => {
    setSignedIn(false);
    mount();
    await focus();
    expect(fetchMyAccess).not.toHaveBeenCalled();
  });
});
