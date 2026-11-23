// tests/live/matrix.live.js — read-only and refused writes (plan Task 28).
//
// Changes nothing when the backend is right. Works on this run's records
// (fixtures.js createRun(), made fresh by globalSetup), never on the static
// 136 rows, so it repeats back to back with no re-seed. Runs before
// flows.live.js, which moves those records. A refused write that SUCCEEDS
// here is a leak; the next run starts from fresh records anyway.
//
// Contract (exact statuses, no "either" answers):
//   404 = not visible. A record the caller cannot see answers exactly what a
//         missing id answers (status + message), so ids cannot be probed.
//   403 = visible but refused, with the sentence the procedure / Node defines
//         (task-5-report.md, fix-404-report.md). A role without the module is
//         refused at the route: 403 "You do not have permission for this action".
// Never data on a refusal.

const { live, MISSING_ID, day, isRefusal, lookups } = require("./client");
const { currentRun, runIds } = require("./fixtures");

const c = live();
let id;
let lk;
let run;

beforeAll(async () => {
  run = await currentRun(); // after the TestCRM proof (client.js)
  id = runIds(run, await c.ids());
  lk = await lookups(c);
});


const post = (who, path, body) => c.as(who).post(path, body);
const opens = async (who, path, key, recordId) => (await post(who, path, { [key]: recordId })).status;
const NO_MODULE = { status: 403, message: "You do not have permission for this action" };
const outcome = (r) => ({ status: r.status, message: r.body?.message, refused: isRefusal(r) });

/**
 * For each [name, path, body(recordId), expected]: the call on the real record
 * and on MISSING_ID give the same status + message, equal to `expected`, and
 * carry no data.
 */
async function expectAllRefused(who, cases) {
  for (const [name, path, body, expected] of cases) {
    const [r, missing] = [await post(who, path, body(false)), await post(who, path, body(true))];
    expect({ name, ...outcome(r) }).toEqual({ name, ...expected, refused: true });
    expect({ name, ...outcome(missing) }).toEqual({ name, ...outcome(r) });
  }
}

/** Upload on the real record vs a missing one: identical refusal. */
async function expectUploadRefused(who, Entity, recordId, expected) {
  const r = await c.as(who).upload("/api/attachments/save", { Entity, EntityId: recordId });
  const missing = await c.as(who).upload("/api/attachments/save", { Entity, EntityId: MISSING_ID });
  expect(outcome(r)).toEqual({ ...expected, refused: true });
  expect(outcome(missing)).toEqual(outcome(r));
}

// ---------------------------------------------------------------------------
describe("kasak on roshan's lead L03 (scenario 10)", () => {
  const LEAD_404 = { status: 404, message: "Lead not found" };
  const L = (m) => (m ? MISSING_ID : id.L03);

  it("detail, every write and every record read: 404 as for a missing id (module gate: 403)", () => expectAllRefused("kasak", [
    ["fetchLeadDetail", "/api/leads/fetchLeadDetail", (m) => ({ LeadId: L(m) }), LEAD_404],
    ["setLeadStatus", "/api/leads/setLeadStatus", (m) => ({ LeadId: L(m), StatusId: lk.leadOpen }), LEAD_404],
    ["transferLead", "/api/leads/transferLead", (m) => ({ LeadId: L(m), ToUserId: id.users.kasak, ReasonId: lk.reasonId, Remarks: "AM live" }), LEAD_404],
    ["send back", "/api/leads/transferLead", (m) => ({ LeadId: L(m), SendBack: true, Remarks: "AM live" }), LEAD_404],
    ["bulkTransferLeads", "/api/leads/bulkTransferLeads", (m) => ({ LeadIds: [L(m)], ToUserId: id.users.kasak, ReasonId: lk.reasonId, Remarks: "AM live" }),
      { status: 404, message: "Record not found (1 of 1 refused)" }],
    ["deleteLeads", "/api/leads/deleteLeads", (m) => ({ Id: L(m) }), NO_MODULE],
    ["convertLead", "/api/leads/convertLead", (m) => ({ LeadId: L(m), WonValue: 1 }), LEAD_404],
    ["scheduleFollowUp", "/api/followups/scheduleFollowUp", (m) => ({ LeadId: L(m), Type: "call", DueAt: `${day(1)}T11:00:00`, AssignedTo: id.users.kasak }), LEAD_404],
    ["fetchFollowups by lead", "/api/followups/fetchFollowups", (m) => ({ LeadId: L(m) }), LEAD_404],
    ["logCall", "/api/calls/logCall", (m) => ({ LeadId: L(m), Direction: "out", Notes: "AM live" }), LEAD_404],
    ["fetchCalls", "/api/calls/fetchCalls", (m) => ({ LeadId: L(m) }), LEAD_404],
    ["saveQuotation", "/api/quotations/saveQuotation", (m) => ({ LeadId: L(m), Lines: [{ description: "AM live", qty: 1, rate: 1 }] }), LEAD_404],
    ["ensureQuoteProfile", "/api/quotations/ensureQuoteProfile", (m) => ({ LeadId: L(m) }), LEAD_404],
    ["attachment list", "/api/attachments/fetch", (m) => ({ Entity: "lead", EntityId: L(m) }), LEAD_404],
  ]));

  it("attachment upload: 404 as for a missing lead", () => expectUploadRefused("kasak", "lead", id.L03, LEAD_404));

  it("quotations by LeadId: 200 with zero rows", async () => {
    const r = await post("kasak", "/api/quotations/fetchQuotations", { LeadId: id.L03 });
    expect(r.status).toBe(200);
    expect(r.body.data.quotations).toEqual([]);
  });
});

describe("kasak's lists only narrow (F9, scenario 10)", () => {
  it("fetchLeads { OwnerId: roshan } answers 200 with zero rows", async () => {
    const r = await post("kasak", "/api/leads/fetchLeads", { OwnerId: id.users.roshan, PageSize: 200 });
    expect(r.status).toBe(200);
    expect(r.body.data.leads).toEqual([]);
  });

  it.each([["L03", "name"], ["L03", "mobile"], ["L09", "name"], ["L05", "name"]])("fetchLeads { SearchTerm: %s's %s } finds nothing", async (k, field) => {
    const r = await post("kasak", "/api/leads/fetchLeads", { SearchTerm: run.lead(k)[field], PageSize: 200 });
    expect(r.status).toBe(200);
    expect(r.body.data.leads).toEqual([]);
  });
});

describe("kasak after handing L09 over (F1)", () => {
  it("detail is 404 as for a missing id", () => expectAllRefused("kasak", [
    ["fetchLeadDetail", "/api/leads/fetchLeadDetail", (m) => ({ LeadId: m ? MISSING_ID : id.L09 }), { status: 404, message: "Lead not found" }],
  ]));

  it("done follow-ups list no row of L09 (and do list her L01 one, so the search works)", async () => {
    const r = await post("kasak", "/api/followups/fetchFollowups", { Status: "done", SearchTerm: run.tag, PageSize: 200 });
    expect(r.status).toBe(200);
    const rows = r.body.data.followups;
    expect(rows.map((f) => f.Id)).toContain(run.followUp("L01_kasak_done").id);
    const leak = rows.filter((f) => f.LeadId === id.L09 || f.LeadName === run.lead("L09").name);
    expect(leak).toEqual([]);
  });

  it("her own done follow-up on it cannot be completed, skipped or deleted: 404 as for a missing one", async () => {
    const fus = (await post("amit", "/api/leads/fetchLeadDetail", { LeadId: id.L09 })).body.data.followups;
    const fu = fus.find((f) => f.Id === run.followUp("L09_kasak_done").id && f.AssignedTo === id.users.kasak);
    expect(fu).toBeDefined();
    const F = (m) => (m ? MISSING_ID : fu.Id);
    const FU_404 = { status: 404, message: "Follow-up not found" };
    await expectAllRefused("kasak", [
      ["completeFollowUp", "/api/followups/completeFollowUp", (m) => ({ Id: F(m), Remarks: "AM live" }), FU_404],
      ["skipFollowUp", "/api/followups/skipFollowUp", (m) => ({ Id: F(m), Remarks: "AM live" }), FU_404],
      ["deleteFollowup", "/api/followups/deleteFollowup", (m) => ({ Id: F(m) }), FU_404],
    ]);
  });

  it("the sales report is not her module: 403", async () => {
    const r = await post("kasak", "/api/reports/salesRows", {
      GroupBy: "team", Metric: "call", PersonId: id.users.kasak, FromDate: day(-7), ToDate: day(0),
    });
    expect(outcome(r)).toEqual({ ...NO_MODULE, refused: true });
  });

  it("L05 (unassigned by a manager) is 404 for its logger (F13)", () => expectAllRefused("kasak", [
    ["fetchLeadDetail", "/api/leads/fetchLeadDetail", (m) => ({ LeadId: m ? MISSING_ID : id.L05 }), { status: 404, message: "Lead not found" }],
  ]));
});

// ---------------------------------------------------------------------------
describe("nitin on C01, which he logged and gave to vinod", () => {
  const C_404 = { status: 404, message: "Complaint not found" };
  const T = (m) => (m ? MISSING_ID : id.C01);

  it("detail, every write and every record read: 404 as for a missing id (module gate: 403)", () => expectAllRefused("nitin", [
    ["fetchTicketDetail", "/api/tickets/fetchTicketDetail", (m) => ({ TicketId: T(m) }), C_404],
    ["setTicketStatus", "/api/tickets/setTicketStatus", (m) => ({ TicketId: T(m), StatusId: lk.ticketOnHold ?? lk.ticketOpen, Remarks: "AM live" }), C_404],
    ["resolveTicket", "/api/tickets/resolveTicket", (m) => ({ TicketId: T(m), ResolutionId: lk.resolutionId, Remarks: "AM live" }), C_404],
    ["closeTicket", "/api/tickets/closeTicket", (m) => ({ TicketId: T(m), ResolutionId: lk.resolutionId, Remarks: "AM live" }), C_404],
    ["rejectTicket", "/api/tickets/rejectTicket", (m) => ({ TicketId: T(m), Remarks: "AM live" }), C_404],
    ["reopenTicket", "/api/tickets/reopenTicket", (m) => ({ TicketId: T(m), Remarks: "AM live" }), C_404],
    ["escalateTicket", "/api/tickets/escalateTicket", (m) => ({ TicketId: T(m), ToUserId: id.users.rohit, Remarks: "AM live" }), C_404],
    ["transferTicket", "/api/tickets/transferTicket", (m) => ({ TicketId: T(m), ToUserId: id.users.nitin, ReasonId: lk.reasonId, Remarks: "AM live" }),
      { status: 404, message: "Record not found" }],
    ["send back", "/api/tickets/transferTicket", (m) => ({ TicketId: T(m), SendBack: true, Remarks: "AM live" }),
      { status: 404, message: "Record not found" }],
    ["bulkTransferTickets", "/api/tickets/bulkTransferTickets", (m) => ({ TicketIds: [T(m)], ToUserId: id.users.nitin, ReasonId: lk.reasonId, Remarks: "AM live" }),
      { status: 404, message: "Record not found (1 of 1 refused)" }],
    ["deleteTicket", "/api/tickets/deleteTicket", (m) => ({ Id: T(m) }), NO_MODULE],
    ["logCall", "/api/calls/logCall", (m) => ({ TicketId: T(m), Direction: "out", Notes: "AM live" }), C_404],
    ["fetchCalls", "/api/calls/fetchCalls", (m) => ({ TicketId: T(m) }), C_404],
    ["attachment list", "/api/attachments/fetch", (m) => ({ Entity: "ticket", EntityId: T(m) }), C_404],
  ]));

  // FR-I1 (139): nitin logged C01 onto vinod in this run, so he may still add the
  // photos he staged — upload only, for 15 minutes after CreatedAt. Every read
  // above stays refused; a missing id is still the plain 404. (createRun makes C01
  // fresh at the start of the run, well inside the window.)
  it("attachment upload: the logger may still add files right after logging it; a missing id is 404", async () => {
    const r = await c.as("nitin").upload("/api/attachments/save", { Entity: "ticket", EntityId: id.C01 });
    const missing = await c.as("nitin").upload("/api/attachments/save", { Entity: "ticket", EntityId: MISSING_ID });
    expect(r.status).toBe(201);
    expect(outcome(missing)).toEqual({ ...C_404, refused: true });
  });

  it("escalation targets for the complaint are empty", async () => {
    const r = await post("nitin", "/api/tickets/fetchEscalationTargets", { TicketId: id.C01 });
    expect(r.status).toBe(200);
    expect(r.body.data.users).toEqual([]);
  });

  it.each([["C01", "subject"], ["C01", "contact"], ["C03", "subject"]])("fetchTickets { SearchTerm: %s's %s } finds nothing", async (k, field) => {
    const r = await post("nitin", "/api/tickets/fetchTickets", { SearchTerm: run.complaint(k)[field], PageSize: 200 });
    expect(r.status).toBe(200);
    expect(r.body.data.tickets).toEqual([]);
  });

  it("Logged by me holds one line with exactly the twelve fields, Id null", async () => {
    const r = await post("nitin", "/api/tickets/fetchLoggedByMe", { SearchTerm: run.complaint("C01").subject, PageSize: 50 });
    expect(r.status).toBe(200);
    const rows = r.body.data.rows.filter((x) => x.Subject === run.complaint("C01").subject);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual([
      "AssignedToName", "CanOpen", "ClosedOn", "CreatedAt", "CustomerName", "DueAt",
      "Id", "IsOverdue", "StatusCode", "StatusName", "Subject", "TicketNo",
    ]);
    expect(rows[0].Id).toBeNull();
    expect(Boolean(rows[0].CanOpen)).toBe(false);
    expect(Object.keys(rows[0]).filter((k) => /phone|mobile|contact|address|priority|resolution|description/i.test(k))).toEqual([]);
  });
});

describe("nitin elsewhere", () => {
  it("C03 (unassigned by a manager) is 404 for its logger (D15)", () => expectAllRefused("nitin", [
    ["fetchTicketDetail", "/api/tickets/fetchTicketDetail", (m) => ({ TicketId: m ? MISSING_ID : id.C03 }), { status: 404, message: "Complaint not found" }],
  ]));

  it("the customer page lists only complaints he can open, and its counts match (F3, F4)", async () => {
    const r = await post("nitin", "/api/customers/fetchCustomerDetail", { CustomerId: id.customers.HO });
    expect(r.status).toBe(200);
    const { customer, tickets } = r.body.data;
    expect(customer.TotalTickets).toBe(tickets.length);
    expect(customer.OpenTickets).toBe(tickets.filter((t) => ["open", "onhold"].includes(t.StatusCode)).length);
    const statuses = await Promise.all(tickets.map((t) => opens("nitin", "/api/tickets/fetchTicketDetail", "TicketId", t.Id)));
    expect(statuses.filter((s) => s !== 200)).toEqual([]);
    expect(tickets.map((t) => t.Id)).not.toContain(id.C01);
  });

  it("escalation targets { ForUserId: pooja } are empty (F7)", async () => {
    const r = await post("nitin", "/api/tickets/fetchEscalationTargets", { ForUserId: id.users.pooja });
    expect(r.status).toBe(200);
    expect(r.body.data.users).toEqual([]);
  });

  it("logging a complaint for kasak, who cannot work it, is refused (scenario 15)", async () => {
    const r = await post("nitin", "/api/tickets/saveTicket", {
      CustomerId: id.customers.HO, Subject: `${run.tag}-M15 must not be saved`, AssignedTo: id.users.kasak,
    });
    expect(outcome(r)).toEqual({ status: 403, message: "You cannot assign records to that person", refused: true });
  });
});

describe("escalation targets on a complaint that is not theirs", () => {
  it.each(["vinod", "rohit"])("%s on C16 (North Delhi) gets none", async (who) => {
    const r = await post(who, "/api/tickets/fetchEscalationTargets", { TicketId: id.C16 });
    expect(r.status).toBe(200);
    expect(r.body.data.users).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("vinod, holder of C01: visible, so refusals are 403 with the gate's sentence", () => {
  it("C13's linked lead (roshan's) is blanked (F24)", async () => {
    const r = await post("vinod", "/api/tickets/fetchTicketDetail", { TicketId: id.C13 });
    expect(r.status).toBe(200);
    expect(r.body.data.ticket.LinkedLeadId).toBeNull();
    expect(r.body.data.linkedLead).toBeNull();
  });

  const reassign = (TicketId, ToUserId) => post("vinod", "/api/tickets/transferTicket", {
    TicketId, ToUserId, ReasonId: lk.reasonId, Remarks: "AM live",
  });

  it("cannot reassign his resolved C05 (F26)", async () => {
    expect(outcome(await reassign(id.C05, id.users.vivek)))
      .toEqual({ status: 403, message: "Only a manager can reassign a closed record", refused: true });
  });

  it.each(["kasak", "hr", "gone"])("cannot hand C01 to %s, who cannot work it (F5)", async (who) => {
    expect(outcome(await reassign(id.C01, id.users[who])))
      .toEqual({ status: 403, message: "You cannot assign records to that person", refused: true });
  });

  it("cannot unassign C01 (a manager's act)", async () => {
    expect(outcome(await reassign(id.C01, null)))
      .toEqual({ status: 403, message: "Only a manager can leave a record unassigned", refused: true });
  });
});

describe("walls", () => {
  const C = (tag) => (m) => ({ TicketId: m ? MISSING_ID : id[tag] });
  const C_404 = { status: 404, message: "Complaint not found" };

  it("prasant: C06's closed escalation gives nothing (F23)", () =>
    expectAllRefused("prasant", [["detail", "/api/tickets/fetchTicketDetail", C("C06"), C_404]]));

  it("pooja (North Delhi): C01 is 404", () =>
    expectAllRefused("pooja", [["detail", "/api/tickets/fetchTicketDetail", C("C01"), C_404]]));

  it("ndmgr (North Delhi manager): C01 and L01 are 404", () => expectAllRefused("ndmgr", [
    ["complaint", "/api/tickets/fetchTicketDetail", C("C01"), C_404],
    ["lead", "/api/leads/fetchLeadDetail", (m) => ({ LeadId: m ? MISSING_ID : id.L01 }), { status: 404, message: "Lead not found" }],
  ]));

  it("am_hr (no complaints, customers or dashboard module) is refused at the route (F6)", async () => {
    for (const [path, body] of [
      ["/api/tickets/fetchTickets", { PageSize: 200 }],
      ["/api/reports/getDashboard", {}],
      ["/api/customers/fetchCustomerDetail", { CustomerId: id.customers.HO }],
      ["/api/users/fetchAssignableUsers", {}],
    ]) {
      expect({ path, ...outcome(await post("hr", path, body)) }).toEqual({ path, ...NO_MODULE, refused: true });
    }
  });

  it("am_gone (inactive) cannot sign in at all", async () => {
    const r = await c.trySignIn("gone");
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it("kasak's dashboard counts no complaints; pooja's counts at most what she can open", async () => {
    const k = await post("kasak", "/api/reports/getDashboard", {});
    expect(k.status).toBe(200);
    expect(k.body.data.quarterlyActivity.map((q) => Number(q.Tickets) || 0).every((n) => n === 0)).toBe(true);

    const p = await post("pooja", "/api/reports/getDashboard", {});
    expect(p.status).toBe(200);
    const counted = p.body.data.quarterlyActivity.reduce((n, q) => n + (Number(q.Tickets) || 0), 0);
    const visible = (await post("pooja", "/api/tickets/fetchTickets", { PageSize: 1 })).body.data.pagination.totalRecords;
    expect(counted).toBeLessThanOrEqual(visible);
  });

  it("am_readonly's assign list has nobody from HEAD OFFICE except his manager", async () => {
    const r = await post("readonly", "/api/users/fetchAssignableUsers", { Module: "complaints" });
    expect(r.status).toBe(200);
    const headOffice = r.body.data.users.filter((u) => Number(u.BranchId) === 1).map((u) => u.Id);
    expect(headOffice.filter((x) => x !== id.users.amit)).toEqual([]);
  });
});

describe("customer pages (out of reach answers exactly like missing: 404, final review m5)", () => {
  const detail = (who, tag) => post(who, "/api/customers/fetchCustomerDetail", { CustomerId: id.customers[tag] });
  const NO_CUSTOMER = { status: 404, message: "Customer not found", refused: true };

  it("pooja and ndmgr (North Delhi) open customer ND with C16 on it, and are refused HEAD OFFICE and SOUTH EXTENSION", async () => {
    for (const who of ["pooja", "ndmgr"]) {
      const nd = await detail(who, "ND");
      expect({ who, status: nd.status }).toEqual({ who, status: 200 });
      expect(nd.body.data.tickets.map((t) => t.Id)).toContain(id.C16);
      expect(nd.body.data.customer.TotalTickets).toBe(nd.body.data.tickets.length);
      for (const tag of ["HO", "SE"]) expect({ who, tag, ...outcome(await detail(who, tag)) }).toEqual({ who, tag, ...NO_CUSTOMER });
    }
    const missing = await post("pooja", "/api/customers/fetchCustomerDetail", { CustomerId: MISSING_ID });
    expect(outcome(missing)).toEqual({ status: 404, message: "Customer not found", refused: true });
  });

  it("vikram (Company) opens all three; customer ND lists C16", async () => {
    for (const tag of ["HO", "ND", "SE"]) expect({ tag, status: (await detail("vikram", tag)).status }).toEqual({ tag, status: 200 });
    expect((await detail("vikram", "ND")).body.data.tickets.map((t) => t.Id)).toContain(id.C16);
  });

  it("pooja cannot edit a customer (no customers edit): 403 at the route", async () => {
    const nd = run.customer("ND");
    const r = await post("pooja", "/api/customers/saveCustomer", { Id: nd.id, Name: nd.name, Mobile: nd.mobile });
    expect(outcome(r)).toEqual({ ...NO_MODULE, refused: true });
  });

  it("ndmgr cannot move customer ND into HEAD OFFICE", async () => {
    const nd = run.customer("ND");
    const r = await post("ndmgr", "/api/customers/saveCustomer", {
      Id: nd.id, Name: nd.name, Mobile: nd.mobile, BranchId: 1,
    });
    expect(outcome(r)).toEqual({ status: 403, message: "You cannot add customers to that office", refused: true });
  });
});

describe("report drills with someone else in the cell", () => {
  it("stl asking for roshan's New leads (roshan is outside his tree) gets no rows and no total", async () => {
    const r = await post("stl", "/api/reports/salesRows", {
      GroupBy: "team", Metric: "new", PersonId: id.users.roshan, FromDate: day(-7), ToDate: day(0),
    });
    expect(r.status).toBe(200);
    expect(r.body.data.rows).toEqual([]);
    expect(r.body.data.total).toBe(0);
  });

  it.each([
    ["kasak", "ndmgr"],
    ["pooja", "vinod"],
  ])("%s naming %s as OwnerId in TAT / TAT clocks / attendance gets no rows", async (who, other) => {
    const OwnerId = id.users[other];
    const range = { FromDate: day(-29), ToDate: day(0) };
    const tat = await post(who, "/api/reports/tat", { ...range, OwnerId });
    expect(tat.status).toBe(200);
    expect(tat.body.data.rows).toEqual([]);
    const clocks = await post(who, "/api/reports/tatClocks", { ...range, OwnerId, Metric: "finished" });
    expect(clocks.status).toBe(200);
    expect(clocks.body.data.clocks).toEqual([]);
    const att = await post(who, "/api/reports/attendance", { ...range, OwnerId });
    expect(att.status).toBe(200);
    expect(att.body.data.rows).toEqual([]);
  });
});

describe("result leads cannot be moved by staff (scenario 18)", () => {
  it("kasak bulk-reassigning her lost L02 and won L08 is 403 and nothing moves", async () => {
    const r = await post("kasak", "/api/leads/bulkTransferLeads", {
      LeadIds: [id.L02, id.L08], ToUserId: id.users.roshan, ReasonId: lk.reasonId, Remarks: "AM live",
    });
    expect(outcome(r)).toEqual({ status: 403, message: "Only a manager can reassign a closed record (2 of 2 refused)", refused: true });
    for (const LeadId of [id.L02, id.L08]) {
      const d = await post("amit", "/api/leads/fetchLeadDetail", { LeadId });
      expect(d.body.data.lead.OwnerId).toBe(id.users.kasak);
    }
  });
});

describe("a closed lead cannot be reopened by staff (FR-I2, 139)", () => {
  it("kasak's lost L02: CanReopen 0 and setLeadStatus -> Open is 403; neha's detail says CanReopen 1", async () => {
    const mine = await post("kasak", "/api/leads/fetchLeadDetail", { LeadId: id.L02 });
    expect(Boolean(mine.body.data.lead.CanReopen)).toBe(false);
    const r = await post("kasak", "/api/leads/setLeadStatus", { LeadId: id.L02, StatusId: lk.leadOpen });
    expect(outcome(r)).toEqual({ status: 403, message: "Only a manager can reopen a closed lead", refused: true });
    const d = await post("neha", "/api/leads/fetchLeadDetail", { LeadId: id.L02 });
    expect(Boolean(d.body.data.lead.CanReopen)).toBe(true);
    expect(d.body.data.lead.StatusCode).toBe("lost");
  });
});

describe("a delegated follow-up seen by a team lead (scenario 19, D5)", () => {
  it("stl sees am_field's visit on L01 as Via 3 without the mobile, and cannot complete it", async () => {
    const r = await post("stl", "/api/followups/fetchFollowups", { Status: "open", SearchTerm: run.tag, PageSize: 200 });
    expect(r.status).toBe(200);
    const row = r.body.data.followups.find((f) => f.Id === run.followUp("L01_field_visit").id);
    expect(row).toBeDefined();
    expect(row.Via).toBe(3);
    expect(row.LeadMobile).toBeNull();
    const done = await post("stl", "/api/followups/completeFollowUp", { Id: row.Id, Remarks: "AM live" });
    expect(outcome(done)).toEqual({ status: 403, message: "You can view this follow-up but not act on it", refused: true });
  });
});

// ---------------------------------------------------------------------------
describe("the assign picker", () => {
  const ids = async (who, body) => {
    const r = await post(who, "/api/users/fetchAssignableUsers", body);
    expect({ who, status: r.status }).toEqual({ who, status: 200 });
    return r.body.data.users.map((u) => u.Id);
  };

  it("nitin's (complaints) holds the complaint workers of his office, nobody else", async () => {
    const got = await ids("nitin", { Module: "complaints" });
    for (const who of ["vinod", "vivek", "prasant", "rohit", "neha", "amit", "imran", "vikram"]) {
      expect({ who, listed: got.includes(id.users[who]) }).toEqual({ who, listed: true });
    }
    for (const who of ["kasak", "hr", "gone", "pooja"]) {
      expect({ who, listed: got.includes(id.users[who]) }).toEqual({ who, listed: false });
    }
  });

  it("kasak's (leads) holds her office's sales people, nobody without leads or from North Delhi", async () => {
    const got = await ids("kasak", { Module: "leads" });
    for (const who of ["roshan", "stl", "field", "neha"]) expect({ who, listed: got.includes(id.users[who]) }).toEqual({ who, listed: true });
    for (const who of ["nitin", "vinod", "hr", "gone", "ndmgr"]) expect({ who, listed: got.includes(id.users[who]) }).toEqual({ who, listed: false });
  });

  it("extra keys cannot widen kasak's list (BranchId, ForUserId, a RecordId she cannot see)", async () => {
    const plain = await ids("kasak", { Module: "leads" });
    const widened = await ids("kasak", { Module: "leads", BranchId: 6, ForUserId: id.users.ndmgr, RecordId: id.L03 });
    expect(widened).toEqual(plain);
  });

  it("vinod's (complaints) ranks his manager rohit and his peer vivek in the team group (140)", async () => {
    const r = await post("vinod", "/api/users/fetchAssignableUsers", { Module: "complaints" });
    expect(r.status).toBe(200);
    const rank = (who) => r.body.data.users.find((u) => u.Id === id.users[who])?.GroupRank;
    expect({ rohit: rank("rohit"), vivek: rank("vivek") }).toEqual({ rohit: 1, vivek: 1 });
  });

  it("nitin asking for the leads list (no leads module) is refused", async () => {
    expect(outcome(await post("nitin", "/api/users/fetchAssignableUsers", { Module: "leads" }))).toEqual({ ...NO_MODULE, refused: true });
  });

  it("imran (Can assign to: Company) can assign to pooja", async () => {
    expect(await ids("imran", { Module: "complaints" })).toContain(id.users.pooja);
  });

  it("every row has exactly the ten documented fields; AwayToday is a boolean", async () => {
    const r = await post("nitin", "/api/users/fetchAssignableUsers", { Module: "complaints" });
    expect(r.body.data.users.length).toBeGreaterThan(0);
    for (const u of r.body.data.users) {
      expect(Object.keys(u).sort()).toEqual([
        "Avatar", "AwayToday", "BranchId", "BranchName", "FullName", "GroupRank", "Id", "IsGiver", "JobTitle", "ReportsTo",
      ]);
      expect(typeof u.AwayToday).toBe("boolean");
    }
  });
});

// Positive cases: allowed things work, or the refusals above prove nothing.
describe("allowed", () => {
  it("rohit opens C01 (his team) and C04 (escalated to him)", async () => {
    expect(await opens("rohit", "/api/tickets/fetchTicketDetail", "TicketId", id.C01)).toBe(200);
    expect(await opens("rohit", "/api/tickets/fetchTicketDetail", "TicketId", id.C04)).toBe(200);
  });

  it("neha and amit open every HEAD OFFICE complaint and lead", async () => {
    const complaints = Object.keys(id).filter((k) => /^C\d\d$/.test(k) && !["C16", "C19", "C21"].includes(k));
    const leads = Object.keys(id).filter((k) => /^L\d\d$/.test(k));
    for (const who of ["neha", "amit"]) {
      const shut = [];
      for (const k of complaints) if (await opens(who, "/api/tickets/fetchTicketDetail", "TicketId", id[k]) !== 200) shut.push(k);
      for (const k of leads) if (await opens(who, "/api/leads/fetchLeadDetail", "LeadId", id[k]) !== 200) shut.push(k);
      expect({ who, shut }).toEqual({ who, shut: [] });
    }
  });

  it("vikram opens C16 (North Delhi)", async () => {
    expect(await opens("vikram", "/api/tickets/fetchTicketDetail", "TicketId", id.C16)).toBe(200);
  });

  it("stl's lead list holds am_field's unassigned L07", async () => {
    const r = await post("stl", "/api/leads/fetchLeads", { SearchTerm: run.lead("L07").name, PageSize: 50 });
    expect(r.status).toBe(200);
    expect(r.body.data.leads.map((l) => l.Id)).toContain(id.L07);
  });
});
