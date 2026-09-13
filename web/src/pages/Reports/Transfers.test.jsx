import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));

import Transfers from "./Transfers";
import renderWithProviders from "../../test/renderWithProviders";
import { mockReportEndpoints, reportData } from "../../test/reportMocks";

describe("Transfers report", () => {
  it("posts grouped by reason, renders the KPIs, and a reason row drills to the plain list", async () => {
    const cap = mockReportEndpoints("/api/reports/transfers", reportData({
      kpis: { Transfers: 72, CrossBranch: 18, SendBacks: 9, Unassigns: 4 },
      rows: [{ GroupKey: 36, GroupLabel: "Absent", SubKey: null, SubLabel: null, Transfers: 30, CrossBranch: 0, SendBacks: 0, Unassigns: 0 }],
      trend: [{ Bucket: "2026-09-01", Transfers: 3 }],
    }));
    renderWithProviders(<Transfers />, { route: "/reports/transfers" });
    const table = await screen.findByTestId("transfers-table");
    expect(cap.body).toMatchObject({ GroupBy: "reason" });
    // One natural date (AssignedAt): the SP ignores DateBasis, so the page must
    // not offer a picker that changes nothing.
    expect(screen.queryByTestId("report-basis-input")).toBeNull();
    const kpis = screen.getByTestId("report-kpis");
    for (const label of ["Transfers", "Cross-branch", "Sent back", "Unassigned"]) expect(kpis).toHaveTextContent(label);
    expect(kpis).toHaveTextContent("72");
    expect(screen.getByTestId("trend-area-legend-Transfers")).toBeInTheDocument();
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      ["Reason", "Transfers", "Cross-branch", "Send-backs", "Unassigns"],
    );
    await userEvent.setup().click(within(table).getByText("Absent"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads");
  });

  it("grouped by pair, a row drills into the receiving rep's leads; by branch, into the branch", async () => {
    mockReportEndpoints("/api/reports/transfers", reportData({
      rows: [{ GroupKey: 17, GroupLabel: "Amit Singh → Sara Khan", SubKey: 18, SubLabel: "Sara Khan", Transfers: 3, CrossBranch: 0, SendBacks: 0, Unassigns: 0 }],
    }));
    const { unmount } = renderWithProviders(<Transfers />, { route: "/reports/transfers?groupBy=pair" });
    let table = await screen.findByTestId("transfers-table");
    expect(within(table).getAllByRole("columnheader")[0]).toHaveTextContent("From → To");
    await userEvent.setup().click(within(table).getByText("Amit Singh → Sara Khan"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?OwnerId=18");
    unmount();

    mockReportEndpoints("/api/reports/transfers", reportData({
      rows: [{ GroupKey: 2, GroupLabel: "SOUTH EXTENSION", SubKey: null, SubLabel: null, Transfers: 5, CrossBranch: 5, SendBacks: 0, Unassigns: 0 }],
    }));
    renderWithProviders(<Transfers />, { route: "/reports/transfers?groupBy=branch" });
    table = await screen.findByTestId("transfers-table");
    await userEvent.setup().click(within(table).getByText("SOUTH EXTENSION"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?BranchId=2");
  });

  it("carries the filter-bar ids into the drill", async () => {
    mockReportEndpoints("/api/reports/transfers", reportData({
      rows: [{ GroupKey: 17, GroupLabel: "Amit Singh → Sara Khan", SubKey: 18, SubLabel: "Sara Khan", Transfers: 5 }],
    }));
    renderWithProviders(<Transfers />, { route: "/reports/transfers?groupBy=pair&BranchId=2" });
    const table = await screen.findByTestId("transfers-table");
    await userEvent.setup().click(within(table).getByText("Amit Singh → Sara Khan"));
    // SubKey is the receiving rep — who holds the leads now.
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?BranchId=2&OwnerId=18");
  });
});
