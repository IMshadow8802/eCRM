// MSW handlers for the Partners screens. `cap.<name>` holds the last posted
// body; `opts.fail` maps an endpoint name to a refusal message (409).
import { http } from "msw";

import { server } from "./mocks/server";
import { json, refuse } from "./supportMocks";

export const partnerRow = (over = {}) => ({
  Id: 1, Name: "Sharma Associates", ContactPerson: "Raj", Mobile: "9825012345", Email: null, City: "Surat", Notes: null,
  CommType: "pct", CommValue: 10, IsActive: true, LeadsSent: 12, Converted: 4, EarnedAmount: 9000, DueAmount: 4000, PaidAmount: 5000,
  ...over,
});

export const commissionRow = (over = {}) => ({
  Id: 11, LeadId: 501, LeadName: "Mehta Jewels", PartnerId: 1, PartnerName: "Sharma Associates", BaseValue: 100000,
  CommType: "pct", CommValue: 10, Amount: 10000, Status: "earned", Reverted: false,
  EarnedAt: "2026-10-01T10:00:00Z", DueAt: null, PaidAt: null, PaidRef: null, ...over,
});

export function mockPartnerEndpoints({ partners = [partnerRow()], commissions = [commissionRow()], fail = {} } = {}) {
  const cap = { calls: {} };
  const route = (name, answer) => server.use(
    http.post(`*/api/partners/${name}`, async ({ request }) => {
      const body = await request.json().catch(() => ({}));
      cap[name] = body;
      (cap.calls[name] ??= []).push(body);
      return fail[name] ? refuse(fail[name], 409) : json(answer(body));
    }),
  );
  route("fetchPartners", () => ({ partners }));
  route("savePartner", () => ({ Id: 9 }));
  route("fetchCommissions", () => ({ commissions }));
  route("setCommissionStatus", () => ({}));
  return cap;
}
