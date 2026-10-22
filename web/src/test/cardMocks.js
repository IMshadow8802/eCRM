// MSW handlers for the Visiting Cards screen. `cap.list` = last fetchCard body.
import { http, HttpResponse } from "msw";

import { server } from "./mocks/server";
import { json } from "./supportMocks";

export const cardRow = (over = {}) => ({
  id: 1, businessName: "Shree Traders", contactPerson: "Ramesh Shah", designation: "Owner",
  mobiles: ["9825012345", "9825012346"], landlines: ["0261-222333"], emails: ["ramesh@shree.in", "sales@shree.in"],
  addresses: ["12 Ring Road, Surat"], website: "shree.in", gstin: "24ABCDE1234F1Z5", description: "Wholesale", other: "Fax 123", notes: "Met at expo",
  createdAt: "2026-10-20T10:00:00Z", updatedAt: "2026-10-20T10:00:00Z",
  frontImage: "cards/u1/front-a.jpg", backImage: "cards/u1/back-a.jpg", ownerName: "Asha Patel", receivedAt: "2026-10-21T09:00:00Z",
  ...over,
});

// `fails` → fetchCard answers 500; `total` → totalRecords (defaults to rows.length).
export function mockCardEndpoints({ rows = [cardRow()], photoFails = false, fails = false, total = rows.length } = {}) {
  const cap = { list: null };
  server.use(
    http.post("*/api/Card/fetchCard", async ({ request }) => {
      cap.list = await request.json().catch(() => ({}));
      if (fails) return HttpResponse.json({ success: false, message: "boom" }, { status: 500 });
      return json({ rows, totalCount: total, pagination: { currentPage: cap.list.PageNumber ?? 1, pageSize: 24, totalRecords: total, totalPages: Math.ceil(total / 24) } });
    }),
    http.get("*/uploads/*", () => (photoFails
      ? new HttpResponse(null, { status: 404 })
      : new HttpResponse(new Blob(["x"], { type: "image/jpeg" }), { headers: { "Content-Type": "image/jpeg" } }))),
  );
  return cap;
}
