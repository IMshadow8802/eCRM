// The five MSW handlers every report page needs: four pick-lists the filter
// bar loads on mount + the report endpoint itself. `capture.body` receives the
// last posted body so a test can assert what the page asked for.
import { http, HttpResponse } from "msw";

import { server } from "./mocks/server";

const json = (data) => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data });

export const reportData = (over = {}) => ({ kpis: {}, rows: [], trend: [], range: {}, ...over });

export function mockReportEndpoints(path, data, capture = {}) {
  server.use(
    http.post("*/api/users/fetchBranches", () => json({ branches: [{ Id: 1, BranchName: "HEAD OFFICE" }, { Id: 2, BranchName: "SOUTH EXTENSION" }] })),
    http.post("*/api/users/fetchAssignableUsers", () => json({ users: [{ Id: 17, FullName: "Amit Singh" }, { Id: 18, FullName: "Sara Khan" }] })),
    http.post("*/api/config/fetchLookups", () => json({ lookups: [{ Id: 11, Value: "Website" }, { Id: 12, Value: "Referral" }] })),
    http.post("*/api/products/fetchProducts", () => json({ products: [{ Id: 1, Name: "Gold Chain 22K" }], pagination: { currentPage: 1, pageSize: 200, totalRecords: 1, totalPages: 1 } })),
    http.post(`*${path}`, async ({ request }) => {
      capture.body = await request.json();
      return typeof data === "function" ? json(data(capture.body)) : json(data);
    }),
  );
  return capture;
}
