import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));

import PipelineValue from "./PipelineValue";
import renderWithProviders from "../../test/renderWithProviders";
import { mockReportEndpoints, reportData } from "../../test/reportMocks";

describe("PipelineValue report", () => {
  it("posts grouped by status, formats money, and drills by status with the range", async () => {
    const cap = mockReportEndpoints("/api/reports/pipelineValue", reportData({
      kpis: { OpenValue: 1250000, QualifiedValue: 480000, LostValue: 300000, OpenCount: 42, AvgValue: 41190.48 },
      rows: [{ GroupKey: 32, GroupLabel: "Qualified", Count: 12, Value: 480000 }],
      trend: [{ Bucket: "2026-09-01", OpenValue: 200000 }],
    }));
    renderWithProviders(<PipelineValue />, { route: "/reports/pipeline-value?preset=custom&from=2026-08-01&to=2026-08-31" });
    const table = await screen.findByTestId("pipelineValue-table");
    expect(cap.body).toMatchObject({ GroupBy: "status" });
    expect(screen.getByTestId("report-kpis")).toHaveTextContent("₹12,50,000.00");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Status", "Leads", "Value"]);
    expect(within(table).getByText("₹4,80,000.00")).toBeInTheDocument();
    await userEvent.setup().click(within(table).getByText("Qualified"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?from=2026-08-01&to=2026-08-31&StatusId=32");
  });

  it("keeps all three date bases and renders the open-value trend", async () => {
    mockReportEndpoints("/api/reports/pipelineValue", reportData({
      kpis: { OpenValue: 0, QualifiedValue: 0, LostValue: 0, OpenCount: 0, AvgValue: null },
      rows: [{ GroupKey: 1, GroupLabel: "HEAD OFFICE", Count: 3, Value: 0 }],
      trend: [{ Bucket: "2026-09-01", OpenValue: 200000 }],
    }));
    renderWithProviders(<PipelineValue />, { route: "/reports/pipeline-value?groupBy=branch" });
    const table = await screen.findByTestId("pipelineValue-table");
    expect(within(table).getAllByRole("columnheader")[0]).toHaveTextContent("Branch");
    expect(screen.getByTestId("trend-area-legend-OpenValue")).toBeInTheDocument();
    // AVG over an empty pipeline is NULL — it must not read as ₹0.00.
    expect(screen.getByTestId("report-kpis")).toHaveTextContent("—");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("report-basis-input"));
    for (const name of ["Created", "Closed", "Activity"]) {
      expect(await screen.findByRole("option", { name })).toBeInTheDocument();
    }
  });
});
