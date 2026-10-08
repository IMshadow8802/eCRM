import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/mocks/server";
import Funnel from "./Funnel";
import { screen, within, waitFor } from "@testing-library/react";

import TatReport from "./TatReport";
import AttendanceReport from "./AttendanceReport";
import renderWithProviders from "../../test/renderWithProviders";
import { mockReportEndpoints, reportData } from "../../test/reportMocks";

describe("Team reports", () => {
  it("TAT renders minutes as 3h 10m, posts the assigned basis and has no drill", async () => {
    const cap = mockReportEndpoints("/api/reports/tat", reportData({
      kpis: { Clocks: 10, Closed: 8, OnTimePct: 80, RanOver: 2, RanOverNotExcused: 1, MedianWorkMin: 190, P90WorkMin: 45 },
      rows: [{ GroupKey: 5, GroupLabel: "Asha", Clocks: 10, MedianWorkMin: 190, P90WorkMin: null }],
      trend: [{ Bucket: "2026-09-01", Closed: 3, OnTime: 2, RanOver: 1 }],
    }));
    renderWithProviders(<TatReport />, { route: "/reports/tat" });
    const table = await screen.findByTestId("tat-table");
    expect(cap.body).toMatchObject({ GroupBy: "person", DateBasis: "assigned" });
    expect(screen.getByTestId("report-kpis")).toHaveTextContent("3h 10m");
    expect(screen.getByTestId("report-kpis")).toHaveTextContent("45m");
    expect(screen.getByTestId("report-kpis")).toHaveTextContent("80.0%");
    expect(screen.getByTestId("report-kpis")).toHaveTextContent("On time (of finished)");
    expect(screen.getByTestId("report-kpis")).toHaveTextContent("Finished");
    expect(within(table).getByText("Asha")).toBeInTheDocument();
    expect(screen.getByTestId("trend-area-legend-RanOver")).toBeInTheDocument();
    expect(screen.queryByTestId("report-basis-input")).toBeNull();
    expect(screen.queryByTestId("report-SourceId-input")).toBeNull();
    expect(screen.queryByTestId("report-ProductId-input")).toBeNull();
    expect(screen.getByTestId("report-OwnerId-input")).toHaveAttribute("placeholder", "All people");
  });

  it("TAT group-by switches to verdict_by", async () => {
    const cap = mockReportEndpoints("/api/reports/tat", reportData({ rows: [{ GroupKey: 1, GroupLabel: "System", Clocks: 1 }] }));
    renderWithProviders(<TatReport />, { route: "/reports/tat?groupBy=verdict_by" });
    await screen.findByTestId("tat-table");
    expect(cap.body).toMatchObject({ GroupBy: "verdict_by" });
  });

  it("Attendance renders per-person rows and KPIs, no group tabs", async () => {
    const cap = mockReportEndpoints("/api/reports/attendance", reportData({
      kpis: { People: 4, WorkingDays: 80, PresentDays: 70, LateDays: 6, MedianLateMin: 75, NotSignedInDays: 4 },
      rows: [{ GroupKey: 5, GroupLabel: "Asha", WorkingDays: 20, PresentDays: 18, LateDays: 2, MedianLateMin: 12, NotSignedInDays: 2 }],
      trend: [{ Bucket: "2026-09-01", Present: 4, Late: 1, NotSignedIn: 0 }],
    }));
    renderWithProviders(<AttendanceReport />, { route: "/reports/attendance" });
    const table = await screen.findByTestId("attendance-table");
    expect(cap.body).toMatchObject({ GroupBy: "person" });
    expect(screen.getByTestId("report-kpis")).toHaveTextContent("1h 15m");
    expect(within(table).getByText("Asha")).toBeInTheDocument();
    expect(screen.queryByTestId("report-groupby")).toBeNull();
  });

  const watch = () => {
    const hits = [];
    for (const p of ["config/fetchLookups", "products/fetchProducts"]) {
      server.use(http.post(`*/api/${p}`, () => { hits.push(p); return HttpResponse.json({ success: true, data: {} }); }));
    }
    return hits;
  };

  it("TAT and Attendance do not fetch sources or products", async () => {
    mockReportEndpoints("/api/reports/tat", reportData({ rows: [{ GroupKey: 5, GroupLabel: "Asha", Clocks: 1 }] }));
    mockReportEndpoints("/api/reports/attendance", reportData({ rows: [{ GroupKey: 5, GroupLabel: "Asha", WorkingDays: 1 }] }));
    const hits = watch();
    renderWithProviders(<TatReport />, { route: "/reports/tat" });
    await screen.findByTestId("tat-table");
    renderWithProviders(<AttendanceReport />, { route: "/reports/attendance" });
    await screen.findByTestId("attendance-table");
    expect(hits).toEqual([]);
  });

  it("a default report page still fetches sources and products", async () => {
    mockReportEndpoints("/api/reports/funnel", reportData());
    const hits = watch();
    renderWithProviders(<Funnel />, { route: "/reports/funnel" });
    await waitFor(() => expect(hits.sort()).toEqual(["config/fetchLookups", "products/fetchProducts"]));
  });
});
