import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));

import Activity from "./Activity";
import renderWithProviders from "../../test/renderWithProviders";
import { mockReportEndpoints, reportData } from "../../test/reportMocks";

const DATA = reportData({
      trend: [{ Bucket: "2026-09-01", Calls: 12, Visits: 3, Meetings: 1 }],
  kpis: { Calls: 300, Visits: 40, Meetings: 12, Other: 3, TalkMinutes: 2450, Inbound: 60, Outbound: 240, Connected: 180 },
  rows: [{ GroupKey: 17, GroupLabel: "Amit Singh", Calls: 120, Visits: 10, Meetings: 4, Other: 1, TalkMinutes: 900, Inbound: 20, Outbound: 100, Connected: 70 }],
});

describe("Activity report", () => {
  it("posts grouped by owner with no basis picker, renders KPIs, and drills into the rep's leads without dates", async () => {
    const cap = mockReportEndpoints("/api/reports/activity", DATA);
    renderWithProviders(<Activity />, { route: "/reports/activity" });
    const table = await screen.findByTestId("activity-table");
    expect(cap.body).toMatchObject({ GroupBy: "owner" });
    expect(screen.queryByTestId("report-basis-input")).toBeNull();
    expect(screen.getByTestId("report-kpis")).toHaveTextContent("2,450");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      ["Owner", "Calls", "Visits", "Meetings", "Other", "Talk min", "Inbound", "Outbound", "Connected"],
    );
    await userEvent.setup().click(within(table).getByText("Amit Singh"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?OwnerId=17");
  });

  it("grouped by day, a row drills to the plain list", async () => {
    mockReportEndpoints("/api/reports/activity", reportData({ rows: [{ GroupKey: 46270, GroupLabel: "2026-09-08", Calls: 9 }] }));
    renderWithProviders(<Activity />, { route: "/reports/activity?groupBy=day" });
    const table = await screen.findByTestId("activity-table");
    expect(within(table).getAllByRole("columnheader")[0]).toHaveTextContent("Day");
    await userEvent.setup().click(within(table).getByText("2026-09-08"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads");
  });

  it("carries the filter-bar ids into the drill", async () => {
    mockReportEndpoints("/api/reports/activity", reportData({
      rows: [{ GroupKey: 17, GroupLabel: "Amit Singh", Calls: 40 }],
    }));
    renderWithProviders(<Activity />, { route: "/reports/activity?groupBy=owner&BranchId=2" });
    const table = await screen.findByTestId("activity-table");
    await userEvent.setup().click(within(table).getByText("Amit Singh"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?BranchId=2&OwnerId=17");
  });
});
