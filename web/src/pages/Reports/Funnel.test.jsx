import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";

import Funnel from "./Funnel";
import renderWithProviders from "../../test/renderWithProviders";
import { mockReportEndpoints, reportData } from "../../test/reportMocks";

describe("Funnel report", () => {
  it("posts to /api/reports/funnel grouped by source and renders its KPIs and columns", async () => {
    const cap = mockReportEndpoints("/api/reports/funnel", reportData({
      kpis: { Created: 42, Contacted: 30, Qualified: 10, Lost: 8, Junk: 2, QualifiedPct: 23.8, LostPct: 19, AvgDaysToContact: 1.2, AvgDaysToQualify: 11.5 },
      rows: [{ GroupKey: 11, GroupLabel: "Website", Created: 42, Contacted: 30, Qualified: 10, Lost: 8, Junk: 2, QualifiedPct: 23.8, LostPct: 19, AvgDaysToQualify: 11.5 }],
      trend: [{ Bucket: "2026-09-01", Created: 4, Qualified: 1, Lost: 0 }],
    }));
    renderWithProviders(<Funnel />, { route: "/reports/funnel" });
    const table = await screen.findByTestId("funnel-table");
    expect(cap.body).toMatchObject({ GroupBy: "source", DateBasis: "created" });
    const kpis = screen.getByTestId("report-kpis");
    for (const label of ["Created", "Contacted", "Qualified", "Lost", "Junk", "Qualified %", "Lost %", "Days to contact", "Days to qualify"]) expect(kpis).toHaveTextContent(label);
    expect(kpis).toHaveTextContent("11.5 d");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      ["Source", "Created", "Contacted", "Qualified", "Lost", "Junk", "Qualified %", "Lost %", "Days to qualify"],
    );
    expect(within(table).getByText("23.8%")).toBeInTheDocument();
    expect(screen.getByTestId("trend-area-legend-Lost")).toBeInTheDocument();
  });
});
