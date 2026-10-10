import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual("react-router-dom")), useNavigate: () => mockNavigate }));

import Partners from "./Partners";
import renderWithProviders from "../../test/renderWithProviders";
import { mockReportEndpoints, reportData } from "../../test/reportMocks";

const ROUTE = "/reports/partners?preset=custom&from=2026-08-01&to=2026-08-31";
const TREND = [{ Bucket: "2026-08-01", LeadsSent: 3, Converted: 1 }, { Bucket: "2026-08-15", LeadsSent: 5, Converted: 2 }];
const FULL = reportData({
  trend: TREND,
  kpis: { LeadsSent: 8, Converted: 3, ConversionPct: 37.5, WonValue: 90000, Earned: 4500, Due: 1500, Paid: 3000 },
  rows: [{ GroupKey: 7, GroupLabel: "Acme Agents", LeadsSent: 8, Converted: 3, ConversionPct: 37.5, WonValue: 90000, Earned: 4500, Due: 1500, Paid: 3000 }],
});
const headers = (t) => within(t).getAllByRole("columnheader").map((h) => h.querySelector(".Mui-TableHeadCell-Content-Wrapper").textContent);

describe("Partners report", () => {
  beforeEach(() => mockNavigate.mockClear());

  it("posts grouped by partner and renders KPIs, trend and a row per partner", async () => {
    const cap = mockReportEndpoints("/api/reports/partners", FULL);
    renderWithProviders(<Partners />, { route: ROUTE });
    const table = await screen.findByTestId("partners-table");
    expect(cap.body).toMatchObject({ GroupBy: "partner", DateBasis: "created", FromDate: "2026-08-01" });
    const kpis = screen.getByTestId("report-kpis");
    for (const l of ["Leads sent", "Converted", "Conversion %", "Won value", "Earned", "Due", "Paid"]) expect(kpis).toHaveTextContent(l);
    expect(headers(table)).toEqual(["Partner", "Leads sent", "Converted", "Conversion %", "Won value", "Earned", "Due", "Paid"]);
    expect(within(table).getByText("Acme Agents")).toBeInTheDocument();
    expect(screen.getByTestId("trend-area-legend-LeadsSent")).toBeInTheDocument();
    expect(screen.getByTestId("trend-area-legend-Converted")).toBeInTheDocument();
  });

  it("shows no money KPIs or columns when the response carries none", async () => {
    mockReportEndpoints("/api/reports/partners", reportData({
      trend: TREND,
      kpis: { LeadsSent: 8, Converted: 3, ConversionPct: 37.5 },
      rows: [{ GroupKey: 7, GroupLabel: "Acme Agents", LeadsSent: 8, Converted: 3, ConversionPct: 37.5 }],
    }));
    renderWithProviders(<Partners />, { route: ROUTE });
    const table = await screen.findByTestId("partners-table");
    expect(headers(table)).toEqual(["Partner", "Leads sent", "Converted", "Conversion %"]);
    const kpis = screen.getByTestId("report-kpis");
    for (const l of ["Won value", "Earned", "Due", "Paid"]) expect(kpis).not.toHaveTextContent(l);
    expect(document.body).not.toHaveTextContent("₹");
  });

  it("row click drills to that partner's leads with the range", async () => {
    mockReportEndpoints("/api/reports/partners", FULL);
    renderWithProviders(<Partners />, { route: ROUTE });
    const table = await screen.findByTestId("partners-table");
    await userEvent.setup().click(within(table).getByText("Acme Agents"));
    expect(mockNavigate).toHaveBeenCalledWith("/sales/leads?from=2026-08-01&to=2026-08-31&PartnerId=7");
  });
});
