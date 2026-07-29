import { describe, it, expect, afterEach } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";

import renderWithProviders from "./test/renderWithProviders";
import { routesConfig } from "./App";
import useAuthStore from "./stores/useAuthStore";
import SectionRedirect from "./components/SectionRedirect";
import HomeRedirect from "./components/HomeRedirect";

const menu = (menuid, parentid, description, route) => ({
  menuid,
  parentid,
  description,
  route,
  permissions: { canView: true, canAdd: false, canEdit: false, canDelete: false },
});

const setRights = (rights) =>
  act(() => useAuthStore.setState({ menuRights: rights }));

const Landed = ({ name }) => <div data-testid="landed">{name}</div>;

afterEach(() => {
  cleanup(); // unmount before clearing auth, else guards re-render mid-teardown
  localStorage.clear();
  setRights([]);
});

// The sidebar parent items (Sales/Support/Settings/Reports) and the rail-mode
// flyout headers navigate to the bare section path; without these redirects
// they hit the 404 catch-all.
describe("section landing redirects", () => {
  it.each([
    ["/sales", "/sales/pipeline"],
    ["/support", "/support/board"],
    ["/settings", "/settings/custom-fields"],
    ["/reports", "/reports/pipeline-funnel"],
    ["/admin", "/users"],
  ])("%s is wired to a SectionRedirect falling back to %s", (from, fallback) => {
    const route = routesConfig.find((r) => r.path === from);
    expect(route).toBeTruthy();
    expect(route.element.type).toBe(SectionRedirect);
    expect(route.element.props.prefix).toBe(from);
    expect(route.element.props.fallback).toBe(fallback);
  });

  it("keeps the concrete child routes reachable (exact paths, not just the parent)", () => {
    const paths = routesConfig.map((r) => r.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/support/board",
        "/support/tickets",
        "/support/tickets/:ticketId",
        "/settings/ticket-categories",
      ]),
    );
  });

  // REGRESSION: these were fixed <Navigate to="/sales/pipeline">, so a user
  // granted Leads but not Pipeline got bounced onto a page they can't open.
  it("sends the user to the first child they are actually granted", () => {
    setRights([
      menu(14, 0, "Sales", "/sales"),
      menu(33, 14, "Follow-ups", "/sales/follow-ups"),
    ]);
    renderWithProviders(
      <Routes>
        <Route
          path="/sales"
          element={<SectionRedirect prefix="/sales" fallback="/sales/pipeline" />}
        />
        <Route path="/sales/pipeline" element={<Landed name="pipeline" />} />
        <Route path="/sales/follow-ups" element={<Landed name="follow-ups" />} />
      </Routes>,
      { route: "/sales" },
    );
    expect(screen.getByTestId("landed")).toHaveTextContent("follow-ups");
  });

  it("uses the fallback when nothing in the section is granted", () => {
    setRights([menu(2, 0, "Tasks", "/tasks")]);
    renderWithProviders(
      <Routes>
        <Route
          path="/sales"
          element={<SectionRedirect prefix="/sales" fallback="/sales/pipeline" />}
        />
        <Route path="/sales/pipeline" element={<Landed name="pipeline" />} />
      </Routes>,
      { route: "/sales" },
    );
    expect(screen.getByTestId("landed")).toHaveTextContent("pipeline");
  });
});

describe("HomeRedirect", () => {
  const renderHome = () =>
    renderWithProviders(
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/login" element={<Landed name="login" />} />
        <Route path="/tasks" element={<Landed name="tasks" />} />
        <Route path="/dashboard" element={<Landed name="dashboard" />} />
      </Routes>,
      { route: "/" },
    );

  it('"/" is a HomeRedirect, not a hardcoded /dashboard', () => {
    const root = routesConfig.find((r) => r.path === "/");
    expect(root.element.type).toBe(HomeRedirect);
  });

  // REGRESSION: "/" was <Navigate to="/dashboard">, which landed a Tasks-only
  // user on a page missing from their own sidebar.
  it("lands the user on their first granted page", () => {
    localStorage.setItem("userData", JSON.stringify({ token: "t" }));
    setRights([menu(2, 0, "Tasks", "/tasks")]);
    renderHome();
    expect(screen.getByTestId("landed")).toHaveTextContent("tasks");
  });

  it("sends a signed-out visitor to login", () => {
    setRights([menu(2, 0, "Tasks", "/tasks")]);
    renderHome();
    expect(screen.getByTestId("landed")).toHaveTextContent("login");
  });

  it("explains itself when the user has no menus at all", () => {
    localStorage.setItem("userData", JSON.stringify({ token: "t" }));
    setRights([]);
    renderHome();
    expect(screen.getByTestId("no-access")).toBeInTheDocument();
  });
});
