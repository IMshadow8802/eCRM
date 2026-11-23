import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import { HelmetProvider } from "react-helmet-async";

import { buildTheme } from "../theme";

vi.mock("../hooks/useApiQuery", () => ({
  useApiQuery: vi.fn(() => ({ data: undefined, isLoading: false })),
}));

import Dashboard from "./Dashboard";
import { useApiQuery } from "../hooks/useApiQuery";
import useAuthStore from "../stores/useAuthStore";

const renderPage = () =>
  render(
    <HelmetProvider>
      <ThemeProvider theme={buildTheme("light")}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <Routes>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/today" element={<div>TODAY PAGE</div>} />
            <Route path="/support/tickets" element={<div>COMPLAINTS PAGE</div>} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </HelmetProvider>,
  );

const menu = (route) => ({ route, permissions: { canView: true } });
const LEADS_USER = { modules: { leads: { view: true, reach: "Own" } } };
const SUPPORT_USER = { modules: { complaints: { view: true, reach: "Own" } } };

const ALL_ZERO = {
  dashboard: [],
  leadsTrend: [
    { Name: "Mon", Leads: 0, Converted: 0 },
    { Name: "Tue", Leads: 0, Converted: 0 },
  ],
  leadsBySource: [],
  funnel: [{ Name: "New", Value: 0 }],
  teamLoad: [],
  quarterlyActivity: [{ Name: "Q1", Leads: 0, Calls: 0, Tickets: 0 }],
};

const KPIS = [
  { Type: "TotalLeads", Number: 100 },
  { Type: "TodayNewLeads", Number: 7 },
  { Type: "TodayFollowups", Number: 3 },
  { Type: "MissedFollowups", Number: 2 },
];

const REAL = {
  dashboard: KPIS,
  leadsTrend: [
    { Name: "Sun", Date: "2026-07-13", Leads: 1, Converted: 0 },
    { Name: "Mon", Date: "2026-07-14", Leads: 2, Converted: 1 },
    { Name: "Tue", Date: "2026-07-15", Leads: 3, Converted: 1 },
    { Name: "Wed", Date: "2026-07-16", Leads: 2, Converted: 0 },
    { Name: "Thu", Date: "2026-07-17", Leads: 5, Converted: 2 },
    { Name: "Fri", Date: "2026-07-18", Leads: 4, Converted: 1 },
    { Name: "Sat", Date: "2026-07-19", Leads: 7, Converted: 3 },
  ],
  leadsBySource: [
    { Name: "Google", Value: 10 },
    { Name: "Referral", Value: 5 },
  ],
  funnel: [
    { Name: "New", Value: 20, SortOrder: 1 },
    { Name: "Qualified", Value: 8, SortOrder: 2 },
  ],
  teamLoad: [
    { Name: "Asha", Value: 12 },
    { Name: "Ravi", Value: 6 },
  ],
  quarterlyActivity: [
    { Name: "Q1", Leads: 10, Calls: 20, Tickets: 5 },
    { Name: "Q2", Leads: 12, Calls: 25, Tickets: 8 },
  ],
};

describe("Dashboard", () => {
  beforeEach(() => {
    useApiQuery.mockReset();
    useAuthStore.setState({ access: LEADS_USER, menuRights: [] });
  });

  /**
   * One card surface on this page, not two.
   *
   * The four KPI cards go through `ui/Card`; the bento tiles hand-rolled their
   * own surface in a Box. They agreed on being white and on nothing else — 16px
   * radius against 36px, a shadow against no shadow, 20px padding against 16px,
   * a lift on hover against a border-colour change. Side by side in one
   * viewport the top row read as a different component from everything under
   * it, which is what "the top 4 cards look odd" means.
   *
   * Asserted by comparing the two rows to each other rather than to fixed
   * numbers, so retuning the card retunes both.
   */
  it("gives the KPI cards and the bento tiles the same surface", () => {
    useApiQuery.mockReturnValue({ data: REAL, isLoading: false });
    const { container } = renderPage();
    const cards = [...container.querySelectorAll("[data-card-surface]")];
    expect(cards.length).toBeGreaterThan(5); // 4 KPI + the tiles

    const shape = (el) => {
      const cs = getComputedStyle(el);
      return { radius: cs.borderRadius, shadow: cs.boxShadow, border: cs.border };
    };
    const first = shape(cards[0]);
    for (const el of cards.slice(1)) expect(shape(el)).toEqual(first);
  });

  // Regression: an empty or all-zero payload used to draw invented demo
  // series ("Google 42", "Visit 1200", a 7-day trend of 169 leads / 78
  // converted) with a small "Sample data" badge.
  it.each([
    ["no data", undefined],
    ["an all-zero payload", ALL_ZERO],
  ])("shows empty states, never demo numbers, for %s", (_label, data) => {
    useApiQuery.mockReturnValue({ data, isLoading: false });
    const { container } = renderPage();
    expect(screen.queryByText("Sample data")).not.toBeInTheDocument();
    for (const demo of ["169", "78", "Google", "Visit", "Calls", "Q3", "Goal"]) {
      expect(screen.queryByText(demo)).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
    // AreaTrend, Donut, Funnel, RadialLoad, ActivityBar
    expect(screen.getAllByText("No data yet")).toHaveLength(5);
    // Only the two rings that draw a real number (today's leads, missed
    // follow-ups, both 0 here) still render a chart.
    expect(container.querySelectorAll(".recharts-responsive-container")).toHaveLength(2);
  });

  it("shows the user's real numbers when series come back", () => {
    useApiQuery.mockReturnValue({ data: REAL, isLoading: false });
    renderPage();
    expect(screen.queryByText("No data yet")).not.toBeInTheDocument();
    expect(screen.getByText("Total Leads")).toBeInTheDocument();
    // KPI card renders the real total
    expect(screen.getAllByText("100").length).toBeGreaterThan(0);
    // trend totals: 24 leads, 8 converted
    expect(screen.getAllByText("24").length).toBeGreaterThan(0);
    expect(screen.getAllByText("8").length).toBeGreaterThan(0);
  });

  describe("without the leads module", () => {
    it("shows one empty state with links only to pages the user can open", () => {
      useAuthStore.setState({
        access: SUPPORT_USER,
        menuRights: [menu("/dashboard"), menu("/support/tickets")],
      });
      useApiQuery.mockReturnValue({ data: REAL, isLoading: false });
      const { container } = renderPage();

      expect(screen.getByText("Nothing to show here")).toBeInTheDocument();
      expect(screen.queryByText("Total Leads")).not.toBeInTheDocument();
      expect(screen.queryByText("100")).not.toBeInTheDocument();
      expect(container.querySelectorAll("[data-card-surface]")).toHaveLength(0);
      expect(screen.queryByRole("button", { name: "Open Today" })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Open Complaints" }));
      expect(screen.getByText("COMPLAINTS PAGE")).toBeInTheDocument();
    });

    it("does not fetch the dashboard numbers", () => {
      useAuthStore.setState({ access: SUPPORT_USER, menuRights: [menu("/today")] });
      useApiQuery.mockReturnValue({ data: undefined, isLoading: false });
      renderPage();
      expect(useApiQuery.mock.calls.at(-1)[0].enabled).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: "Open Today" }));
      expect(screen.getByText("TODAY PAGE")).toBeInTheDocument();
    });

    it("treats a missing access payload as no access", () => {
      useAuthStore.setState({ access: null, menuRights: [] });
      useApiQuery.mockReturnValue({ data: REAL, isLoading: false });
      renderPage();
      expect(screen.getByText("Nothing to show here")).toBeInTheDocument();
      expect(screen.queryAllByRole("button")).toHaveLength(0);
    });
  });

  it("an admin sees the dashboard without a leads grant", () => {
    useAuthStore.setState({ access: { isAdmin: true, modules: {} } });
    useApiQuery.mockReturnValue({ data: REAL, isLoading: false });
    renderPage();
    expect(screen.getByText("Total Leads")).toBeInTheDocument();
  });

  it("labels the radial goal as today's new leads and feeds it the KPI + yesterday's trend value", () => {
    useApiQuery.mockReturnValue({ data: REAL, isLoading: false });
    renderPage();
    expect(screen.getByText("Today's new leads")).toBeInTheDocument();
    expect(screen.queryByText(/Today's conversion/)).not.toBeInTheDocument();
    // Yesterday = second-to-last trend row (Fri, 4 leads)
    expect(screen.getByText("Yesterday")).toBeInTheDocument();
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);
  });

  it("shows this month's Won count and value in the leads-trend subtitle", () => {
    useApiQuery.mockReturnValue({
      data: {
        dashboard: [
          { Type: "WonMonth", Number: 3 },
          { Type: "WonValueMonth", Number: 545000 },
        ],
      },
      isLoading: false,
    });
    renderPage();
    expect(screen.getByText(/Won this month: 3/)).toBeInTheDocument();
    expect(screen.getByText(/5,45,000/)).toBeInTheDocument();
  });

  it("reads 'Won this month: 0' and does not crash when neither Won row comes back", () => {
    useApiQuery.mockReturnValue({ data: { dashboard: [] }, isLoading: false });
    expect(() => renderPage()).not.toThrow();
    expect(screen.getByText(/Won this month: 0/)).toBeInTheDocument();
  });

  it("shows real zeros on the number tiles instead of demo fallbacks", () => {
    useApiQuery.mockReturnValue({
      data: {
        dashboard: [
          { Type: "TotalLeads", Number: 0 },
          { Type: "TodayNewLeads", Number: 0 },
          { Type: "TodayFollowups", Number: 0 },
          { Type: "MissedFollowups", Number: 0 },
        ],
      },
      isLoading: false,
    });
    renderPage();
    // Old hardcoded fallbacks must be gone
    for (const demo of ["62", "47", "26"]) {
      expect(screen.queryByText(demo)).not.toBeInTheDocument();
    }
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });
});
