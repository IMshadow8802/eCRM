import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));

import Lost from "./Lost";
import renderWithProviders from "../../test/renderWithProviders";
import { mockReportEndpoints, reportData } from "../../test/reportMocks";

describe("Lost report", () => {
  it("posts grouped by reason and renders the reason table + top-reason KPI", async () => {
    const cap = mockReportEndpoints("/api/reports/lost", reportData({
      trend: [{ Bucket: "2026-09-01", Lost: 4 }],
      kpis: { Lost: 40, LostPct: 18.2, TopReason: "Price" },
      rows: [{ GroupKey: 22, GroupLabel: "Price", SubKey: null, SubLabel: null, Lost: 14, LostPct: 35 }],
    }));
    renderWithProviders(<Lost />, { route: "/reports/lost?preset=custom&from=2026-08-01&to=2026-08-31" });
    const table = await screen.findByTestId("lost-table");
    // Not "created": a lost-reason report is keyed on when the lead closed.
    expect(cap.body).toMatchObject({ GroupBy: "reason", FromDate: "2026-08-01", DateBasis: "closed" });
    expect(screen.getByTestId("report-kpis")).toHaveTextContent("Price");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Reason", "Reason", "Lost", "Share %"]);
    expect(within(table).getByText("—")).toBeInTheDocument();
    await userEvent.setup().click(within(table).getByText("35.0%"));
    // No from/to: this page runs on the `closed` basis but sp_FetchLeads
    // narrows on CreatedAt, so carrying the range would drill into a
    // different set of leads than the row counted.
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?StatusCode=lost");
  });

  it("grouped by source, the second column is the source and the drill carries its id", async () => {
    mockReportEndpoints("/api/reports/lost", reportData({
      rows: [{ GroupKey: 22, GroupLabel: "Price", SubKey: 11, SubLabel: "Website", Lost: 6, LostPct: 15 }],
    }));
    renderWithProviders(<Lost />, { route: "/reports/lost?groupBy=source&preset=custom&from=2026-08-01&to=2026-08-31" });
    const table = await screen.findByTestId("lost-table");
    expect(within(table).getAllByRole("columnheader")[1]).toHaveTextContent("Source");
    await userEvent.setup().click(within(table).getByText("Website"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?StatusCode=lost&SourceId=11");
  });

  it("carries the range when the basis makes it mean CreatedAt, and the filter-bar ids always", async () => {
    mockReportEndpoints("/api/reports/lost", reportData({
      rows: [{ GroupKey: 22, GroupLabel: "Price", SubKey: 11, SubLabel: "Website", Lost: 6, LostPct: 15 }],
    }));
    renderWithProviders(<Lost />, {
      route: "/reports/lost?groupBy=source&basis=created&preset=custom&from=2026-08-01&to=2026-08-31&BranchId=2",
    });
    const table = await screen.findByTestId("lost-table");
    await userEvent.setup().click(within(table).getByText("Website"));
    // BranchId rides along or the drilled list is wider than the row said.
    expect(mockNavigate).toHaveBeenCalledWith(
      "/sales/leads?StatusCode=lost&from=2026-08-01&to=2026-08-31&BranchId=2&SourceId=11",
    );
  });
});
