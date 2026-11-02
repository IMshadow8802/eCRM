// Lead fetchers against backend/src/controllers/leadController.js. URLs and
// bodies are written from the routes + controller, not from the constants
// under test. Only the wire is fake (src/test/transport).
import { lastRequest, respond } from "../test/transport";
import * as leads from "./leadQueries";

const ENVELOPE = { success: true, message: "OK", data: { Id: 1 } };

const BASE = {
  Name: "Ravi",
  Company: null,
  MobileNo: "9825012345",
  AltMobile: null,
  Email: null,
  Address: null,
  City: "Surat",
  State: null,
  Pincode: null,
  SourceId: 3,
  ProductId: null,
  EstValue: 5000,
  Remarks: null,
};

interface Case {
  call: () => Promise<unknown>;
  url: string;
  body: unknown;
}

const CASES: [string, Case][] = [
  ["fetchLeads", { call: () => leads.fetchLeads(), url: "/api/leads/fetchLeads", body: { PageNumber: 1, PageSize: 50, SearchTerm: null, StatusId: null, StatusCode: null, OwnerId: null, Overdue: false, Unassigned: false } }],
  ["fetchLeads filters", { call: () => leads.fetchLeads({ PageNumber: 2, SearchTerm: "ravi", StatusCode: "open", OwnerId: 4, Overdue: true, Unassigned: true }), url: "/api/leads/fetchLeads", body: { PageNumber: 2, PageSize: 50, SearchTerm: "ravi", StatusId: null, StatusCode: "open", OwnerId: 4, Overdue: true, Unassigned: true } }],
  ["createLead", { call: () => leads.createLead({ ...BASE, StatusId: 1, OwnerId: 4, FirstFollowupAt: "2026-11-03", CustomJSON: "[]" }), url: "/api/leads/saveLeads", body: { Id: 0, ...BASE, StatusId: 1, OwnerId: 4, FirstFollowupAt: "2026-11-03", CustomJSON: "[]" } }],
  ["updateLead", { call: () => leads.updateLead({ Id: 9, ...BASE }), url: "/api/leads/saveLeads", body: { Id: 9, ...BASE, CustomJSON: null } }],
  ["setLeadStatus", { call: () => leads.setLeadStatus({ LeadId: 9, StatusId: 2 }), url: "/api/leads/setLeadStatus", body: { LeadId: 9, StatusId: 2, LostReasonId: null } }],
  ["setLeadStatus lost", { call: () => leads.setLeadStatus({ LeadId: 9, StatusId: 4, LostReasonId: 7 }), url: "/api/leads/setLeadStatus", body: { LeadId: 9, StatusId: 4, LostReasonId: 7 } }],
  ["convertLead", { call: () => leads.convertLead({ LeadId: 9, WonValue: 0 }), url: "/api/leads/convertLead", body: { LeadId: 9, WonValue: 0, Remarks: null } }],
  ["convertLead remarks", { call: () => leads.convertLead({ LeadId: 9, WonValue: 1200, Remarks: "paid" }), url: "/api/leads/convertLead", body: { LeadId: 9, WonValue: 1200, Remarks: "paid" } }],
  ["transferLead", { call: () => leads.transferLead({ LeadId: 9, ToUserId: 4, ToBranchId: null, ReasonId: 2, Remarks: "leave" }), url: "/api/leads/transferLead", body: { LeadId: 9, ToUserId: 4, ToBranchId: null, ReasonId: 2, Remarks: "leave" } }],
];

describe.each(CASES)("%s", (_name, c) => {
  it("posts its documented body to its endpoint and resolves the envelope", async () => {
    respond(ENVELOPE);
    await expect(c.call()).resolves.toEqual(ENVELOPE);
    expect(lastRequest().url).toBe(c.url);
    expect(lastRequest().config.method).toBe("post");
    expect(lastRequest().body).toStrictEqual(c.body);
  });
});

describe("updateLead", () => {
  it("never sends create-only, partner or commission keys, even when the caller's object carries them", async () => {
    respond(ENVELOPE);
    // A screen that spreads the loaded Lead row into the form would hand all of
    // these over; the controller would then re-point the partner or terms.
    const fromRecord = { Id: 9, ...BASE, PartnerId: 5, CommType: "pct", CommValue: 2, StatusId: 1, OwnerId: 4, FirstFollowupAt: "2026-11-03", CustomJSON: "[{}]" };
    await leads.updateLead(fromRecord);
    const { body } = lastRequest();
    for (const key of ["PartnerId", "CommType", "CommValue", "StatusId", "OwnerId", "FirstFollowupAt"]) {
      expect(body).not.toHaveProperty(key);
    }
    expect(body).toHaveProperty("CustomJSON", null);
    expect(body).toStrictEqual({ Id: 9, ...BASE, CustomJSON: null });
  });
});

describe("fetchLeadDetail", () => {
  it("returns the five parts the phone uses", async () => {
    const data = { lead: { Id: 9 }, fields: [{ FieldId: 1 }], activity: [{ Id: 2 }], followups: [{ Id: 3 }], assignments: [{ Id: 4 }], commissions: [{ Id: 5 }] };
    respond({ success: true, data });
    await expect(leads.fetchLeadDetail({ LeadId: 9 })).resolves.toEqual({
      lead: { Id: 9 },
      fields: [{ FieldId: 1 }],
      activity: [{ Id: 2 }],
      followups: [{ Id: 3 }],
      assignments: [{ Id: 4 }],
    });
    expect(lastRequest()).toMatchObject({ url: "/api/leads/fetchLeadDetail", body: { LeadId: 9 } });
  });

  it("fills absent parts with null / []", async () => {
    respond({ success: true, data: null });
    await expect(leads.fetchLeadDetail({ LeadId: 9 })).resolves.toEqual({
      lead: null,
      fields: [],
      activity: [],
      followups: [],
      assignments: [],
    });
  });
});
