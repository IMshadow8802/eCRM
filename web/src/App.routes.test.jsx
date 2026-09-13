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
    ["/sales", "/sales/leads"],
    ["/support", "/support/board"],
    ["/settings", "/settings/custom-fields"],
    ["/reports", "/reports/funnel"],
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

  // REGRESSION: these were a fixed <Navigate>, so a user granted Follow-ups
  // but not the fallback page got bounced onto a page they can't open.
  it("sends the user to the first child they are actually granted", () => {
    setRights([
      menu(14, 0, "Sales", "/sales"),
      menu(33, 14, "Follow-ups", "/sales/follow-ups"),
    ]);
    renderWithProviders(
      <Routes>
        <Route
          path="/sales"
          element={<SectionRedirect prefix="/sales" fallback="/sales/leads" />}
        />
        <Route path="/sales/leads" element={<Landed name="leads" />} />
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
          element={<SectionRedirect prefix="/sales" fallback="/sales/leads" />}
        />
        <Route path="/sales/leads" element={<Landed name="leads" />} />
      </Routes>,
      { route: "/sales" },
    );
    expect(screen.getByTestId("landed")).toHaveTextContent("leads");
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

// Spec 1 retired the lead pipeline board; spec 4a retired the three
// single-number lead reports. Every old path survives only as a redirect so
// bookmarks and the one-release-old sidebar rows land somewhere useful.
describe("retired sales routes", () => {
  const paths = routesConfig.map((r) => r.path);
  const redirect = (from) => {
    const route = routesConfig.find((r) => r.path === from);
    expect(route.element.type.name).toBe("Navigate");
    return route.element.props.to;
  };

  it("has no pipeline page, only a redirect", () => {
    expect(redirect("/sales/pipeline")).toBe("/sales/leads");
  });

  it.each([
    ["/reports/pipeline-funnel", "/reports/funnel"],
    ["/reports/leads-by-status", "/reports/funnel"],
    ["/reports/calls-per-user", "/reports/activity"],
    ["/reports/conversion-by-source", "/reports/funnel?groupBy=source"],
  ])("redirects %s to %s", (from, to) => {
    expect(redirect(from)).toBe(to);
  });

  it("registers products and the eight spec-4a report pages (matching tblMenu.Route)", () => {
    expect(paths).toEqual(expect.arrayContaining([
      "/settings/products",
      "/reports/funnel",
      "/reports/follow-up-compliance",
      "/reports/activity",
      "/reports/lost",
      "/reports/aging",
      "/reports/transfers",
      "/reports/pipeline-value",
      "/reports/leaderboard",
    ]));
  });
});
