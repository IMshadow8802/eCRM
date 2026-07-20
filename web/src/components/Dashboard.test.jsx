import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { HelmetProvider } from "react-helmet-async";

import { buildTheme } from "../theme";

vi.mock("../hooks/useApiQuery", () => ({
  useApiQuery: vi.fn(() => ({ data: undefined, isLoading: false })),
}));

import Dashboard from "./Dashboard";
import { useApiQuery } from "../hooks/useApiQuery";

const renderPage = () =>
  render(
    <HelmetProvider>
      <ThemeProvider theme={buildTheme("light")}>
        <Dashboard />
      </ThemeProvider>
    </HelmetProvider>,
  );

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
  });

  it("shows the sample-data hint on all five big charts when no data comes back", () => {
    useApiQuery.mockReturnValue({ data: undefined, isLoading: false });
    renderPage();
    expect(screen.getAllByText("Sample data")).toHaveLength(5);
  });

  it("treats all-zero series as empty so a fresh company still gets the demo visuals", () => {
    useApiQuery.mockReturnValue({
      data: {
        dashboard: [],
        leadsTrend: REAL.leadsTrend.map((r) => ({ ...r, Leads: 0, Converted: 0 })),
        leadsBySource: [],
        funnel: REAL.funnel.map((r) => ({ ...r, Value: 0 })),
        teamLoad: [],
        quarterlyActivity: REAL.quarterlyActivity.map((r) => ({
          ...r,
          Leads: 0,
          Calls: 0,
          Tickets: 0,
        })),
      },
      isLoading: false,
    });
    renderPage();
    expect(screen.getAllByText("Sample data")).toHaveLength(5);
  });

  it("hides every sample-data hint when real series come back", () => {
    useApiQuery.mockReturnValue({ data: REAL, isLoading: false });
    renderPage();
    expect(screen.queryByText("Sample data")).not.toBeInTheDocument();
    // KPI card renders the real total (also appears as the goal number)
    expect(screen.getAllByText("100").length).toBeGreaterThan(0);
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
