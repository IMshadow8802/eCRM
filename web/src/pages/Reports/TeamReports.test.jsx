import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { waitFor } from "@testing-library/react";

import { server } from "../../test/mocks/server";
import Funnel from "./Funnel";
import renderWithProviders from "../../test/renderWithProviders";
import { mockReportEndpoints, reportData } from "../../test/reportMocks";

// Attendance and TAT have their own pages and tests (AttendanceReport.test.jsx,
// TatReport.test.jsx), including "does not fetch sources or products".
describe("Team reports", () => {
  it("a default report page still fetches sources and products", async () => {
    const hits = [];
    mockReportEndpoints("/api/reports/funnel", reportData());
    for (const p of ["config/fetchLookups", "products/fetchProducts"]) {
      server.use(http.post(`*/api/${p}`, () => { hits.push(p); return HttpResponse.json({ success: true, data: {} }); }));
    }
    renderWithProviders(<Funnel />, { route: "/reports/funnel" });
    await waitFor(() => expect(hits.sort()).toEqual(["config/fetchLookups", "products/fetchProducts"]));
  });
});
