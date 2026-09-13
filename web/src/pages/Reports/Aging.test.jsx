import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));

import Aging from "./Aging";
import renderWithProviders from "../../test/renderWithProviders";
import { mockReportEndpoints, reportData } from "../../test/reportMocks";

describe("Aging report", () => {
  it("posts grouped by owner, renders the age buckets, and drills into the rep's leads without a range", async () => {
    const cap = mockReportEndpoints("/api/reports/aging", reportData({
      kpis: { Open: 210, Age0_7: 60, Age8_30: 90, Age31_90: 45, Age90Plus: 15, NoNextFollowUp: 22, AvgDaysSinceTouch: 6.4 },
      rows: [{ GroupKey: 17, GroupLabel: "Amit Singh", Open: 70, Age0_7: 20, Age8_30: 30, Age31_90: 15, Age90Plus: 5, NoNextFollowUp: 7, AvgDaysSinceTouch: 5.1 }],
      trend: [{ Bucket: "2026-09-01", Open: 200 }],
    }));
    renderWithProviders(<Aging />, { route: "/reports/aging?preset=90d" });
    const table = await screen.findByTestId("aging-table");
    expect(cap.body).toMatchObject({ GroupBy: "owner" });
    expect(screen.queryByTestId("report-basis-input")).toBeNull();
    expect(screen.getByTestId("report-kpis")).toHaveTextContent("6.4 d");
    // The chips are still on screen and still do nothing to these numbers, so
    // the subtitle has to say so — a filter that looks live and is not is worse
    // than no filter at all.
    expect(screen.getByText(/date range does not change these tiles or the table/i)).toBeInTheDocument();
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      ["Owner", "Open", "0–7 d", "8–30 d", "31–90 d", "90+ d", "No next follow-up", "Days since touch"],
    );
    expect(screen.getByTestId("trend-area-legend-Open")).toBeInTheDocument();
    await userEvent.setup().click(within(table).getByText("Amit Singh"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?OwnerId=17");
  });

  it("drills to the plain leads list when the grouping has no Leads filter", async () => {
    mockNavigate.mockClear();
    mockReportEndpoints("/api/reports/aging", reportData({
      kpis: { Open: 0, Age0_7: 0, Age8_30: 0, Age31_90: 0, Age90Plus: 0, NoNextFollowUp: 0, AvgDaysSinceTouch: null },
      rows: [{ GroupKey: 16, GroupLabel: "Neha's team", Open: 12, Age0_7: 3, Age8_30: 4, Age31_90: 4, Age90Plus: 1, NoNextFollowUp: 2, AvgDaysSinceTouch: null }],
    }));
    renderWithProviders(<Aging />, { route: "/reports/aging?groupBy=team" });
    const table = await screen.findByTestId("aging-table");
    expect(within(table).getAllByRole("columnheader")[0]).toHaveTextContent("Team");
    // AVG over an empty set is NULL — "0.0 d" would claim it was touched today.
    expect(within(table).getByText("—")).toBeInTheDocument();
    await userEvent.setup().click(within(table).getByText("Neha's team"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads");
  });

  it("carries the filter-bar ids into the drill", async () => {
    mockReportEndpoints("/api/reports/aging", reportData({
      rows: [{ GroupKey: 17, GroupLabel: "Amit Singh", Open: 70 }],
    }));
    renderWithProviders(<Aging />, { route: "/reports/aging?groupBy=owner&BranchId=2" });
    const table = await screen.findByTestId("aging-table");
    await userEvent.setup().click(within(table).getByText("Amit Singh"));
    // Without BranchId the row says 70 and the drilled list shows every branch.
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?BranchId=2&OwnerId=17");
  });
});
