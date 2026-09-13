import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));

import FollowUpCompliance from "./FollowUpCompliance";
import renderWithProviders from "../../test/renderWithProviders";
import { mockReportEndpoints, reportData } from "../../test/reportMocks";

describe("FollowUpCompliance report", () => {
  it("posts grouped by owner, offers Due/Done date bases, renders KPIs, and drills into the rep's overdue leads", async () => {
    const cap = mockReportEndpoints("/api/reports/followUpCompliance", reportData({
      kpis: { Due: 120, DoneOnTime: 80, DoneLate: 20, Skipped: 5, Missed: 15, OnTimePct: 66.7, AvgDelayHours: 30.5 },
      rows: [{ GroupKey: 17, GroupLabel: "Amit Singh", Due: 60, DoneOnTime: 45, DoneLate: 8, Skipped: 2, Missed: 5, OnTimePct: 75, AvgDelayHours: 26 }],
      trend: [{ Bucket: "2026-09-01", Due: 6, DoneOnTime: 4, DoneLate: 1, Missed: 1 }],
    }));
    renderWithProviders(<FollowUpCompliance />, { route: "/reports/follow-up-compliance" });
    const table = await screen.findByTestId("followUpCompliance-table");
    expect(cap.body).toMatchObject({ GroupBy: "owner", DateBasis: "created" });
    const kpis = screen.getByTestId("report-kpis");
    expect(kpis).toHaveTextContent("66.7%");
    expect(kpis).toHaveTextContent("30.5 h");
    // The Missed KPI counts follow-ups; the drill below lists leads. Same word,
    // different unit — the label has to say which.
    expect(kpis).toHaveTextContent("Missed follow-ups");
    expect(screen.getByTestId("trend-area-legend-Missed")).toBeInTheDocument();
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      ["Owner", "Due", "On time", "Late", "Skipped", "Missed", "On-time %", "Avg delay"],
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("report-basis-input"));
    expect(await screen.findByRole("option", { name: "Done date" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(within(table).getByText("Amit Singh"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?OwnerId=17&Overdue=1");
  });

  it("drills to the plain overdue list when the grouping has no Leads filter", async () => {
    mockNavigate.mockClear();
    mockReportEndpoints("/api/reports/followUpCompliance", reportData({
      kpis: { Due: 40, DoneOnTime: 20, DoneLate: 5, Skipped: 0, Missed: 15, OnTimePct: 50, AvgDelayHours: null },
      rows: [{ GroupKey: 16, GroupLabel: "Neha's team", Due: 40, DoneOnTime: 20, DoneLate: 5, Skipped: 0, Missed: 15, OnTimePct: 50, AvgDelayHours: null }],
    }));
    renderWithProviders(<FollowUpCompliance />, { route: "/reports/follow-up-compliance?groupBy=team" });
    const table = await screen.findByTestId("followUpCompliance-table");
    expect(within(table).getAllByRole("columnheader")[0]).toHaveTextContent("Team");
    // AVG over no late follow-ups is NULL — it must not read as 0.0 h.
    expect(within(table).getByText("—")).toBeInTheDocument();
    await userEvent.setup().click(within(table).getByText("Neha's team"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?Overdue=1");
  });

  it("carries the filter-bar ids into the drill alongside Overdue", async () => {
    mockReportEndpoints("/api/reports/followUpCompliance", reportData({
      rows: [{ GroupKey: 17, GroupLabel: "Amit Singh", Due: 60, Missed: 5 }],
    }));
    renderWithProviders(<FollowUpCompliance />, { route: "/reports/followUpCompliance?groupBy=owner&BranchId=2" });
    const table = await screen.findByTestId("followUpCompliance-table");
    await userEvent.setup().click(within(table).getByText("Amit Singh"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?BranchId=2&OwnerId=17&Overdue=1");
  });
});
