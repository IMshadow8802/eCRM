// tests/live/matrix.live.js — read-only and refused writes (plan Task 28).
//
// Changes nothing when the backend is right, so it can be repeated without
// re-seeding; it expects the 136 seed state: run it before flows.live.js, or
// after a re-seed (137, then 136). A refused write that SUCCEEDS here is a leak
// and does change data: re-seed after fixing it.
//
// Contract: 404 = not visible (missing and invisible answer the same status
// and message); 403 = visible but refused. Never data.

const { live, MISSING_ID, day, isRefusal, lookups } = require("./client");

const c = live();
let id;
let lk;

beforeAll(async () => {
  id = await c.ids(); // refuses the whole file off TestCRM
  lk = await lookups(c);
});

const post = (who, path, body) => c.as(who).post(path, body);

/** 404, no data, and exactly what a missing id answers. */
async function expectHidden(who, path, key, recordId) {
  const [r, missing] = await Promise.all([
    post(who, path, { [key]: recordId }),
    post(who, path, { [key]: MISSING_ID }),
  ]);
  expect(r.status).toBe(404);
  expect(r.body.data ?? null).toBeNull();
  expect({ status: r.status, message: r.body.message }).toEqual({ status: missing.status, message: missing.body.message });
}

const opens = async (who, path, key, recordId) => (await post(who, path, { [key]: recordId })).status;

// ---------------------------------------------------------------------------
describe("kasak on roshan's lead AM-L03 (scenario 10)", () => {
  it("detail is 404, the same as a missing id", () => expectHidden("kasak", "/api/leads/fetchLeadDetail", "LeadId", id.L03));

  const writes = () => [
    ["setLeadStatus", "/api/leads/setLeadStatus", { LeadId: id.L03, StatusId: lk.leadOpen }],
    ["transferLead", "/api/leads/transferLead", { LeadId: id.L03, ToUserId: id.users.kasak, ReasonId: lk.reasonId, Remarks: "AM live" }],
    ["bulkTransferLeads", "/api/leads/bulkTransferLeads", { LeadIds: [id.L03], ToUserId: id.users.kasak, ReasonId: lk.reasonId, Remarks: "AM live" }],
    ["deleteLeads", "/api/leads/deleteLeads", { Id: id.L03 }],
    ["convertLead", "/api/leads/convertLead", { LeadId: id.L03, WonValue: 1 }],
    ["scheduleFollowUp", "/api/followups/scheduleFollowUp", { LeadId: id.L03, Type: "call", DueAt: `${day(1)}T11:00:00`, AssignedTo: id.users.kasak }],
    ["logCall", "/api/calls/logCall", { LeadId: id.L03, Direction: "out", Notes: "AM live" }],
    ["fetchCalls", "/api/calls/fetchCalls", { LeadId: id.L03 }],
    ["saveQuotation", "/api/quotations/saveQuotation", { LeadId: id.L03, Lines: [{ description: "AM live", qty: 1, rate: 1 }] }],
    ["attachment list", "/api/attachments/fetch", { Entity: "lead", EntityId: id.L03 }],
  ];
  it("every write and record read is refused with no data", async () => {
    for (const [name, path, body] of writes()) {
      const r = await post("kasak", path, body);
      expect({ name, refused: isRefusal(r), status: r.status }).toEqual({ name, refused: true, status: r.status });
    }
  });

  it("attachment upload is refused", async () => {
    const r = await c.as("kasak").upload("/api/attachments/save", { Entity: "lead", EntityId: id.L03 });
    expect(isRefusal(r)).toBe(true);
  });

  it("quotations by LeadId are refused or empty", async () => {
    const r = await post("kasak", "/api/quotations/fetchQuotations", { LeadId: id.L03 });
    expect(isRefusal(r) || (r.status === 200 && r.body.data.quotations.length === 0)).toBe(true);
  });
});

describe("kasak's list filters only narrow (F9)", () => {
  it("fetchLeads { OwnerId: roshan } answers 200 with zero rows", async () => {
    const r = await post("kasak", "/api/leads/fetchLeads", { OwnerId: id.users.roshan, PageSize: 200 });
    expect(r.status).toBe(200);
    expect(r.body.data.leads).toEqual([]);
  });
});

describe("kasak after handing AM-L09 over (F1, F2)", () => {
  it("detail is 404", () => expectHidden("kasak", "/api/leads/fetchLeadDetail", "LeadId", id.L09));

  it("done follow-ups list no row of AM-L09", async () => {
    const r = await post("kasak", "/api/followups/fetchFollowups", { Status: "done", PageSize: 200 });
    expect(r.status).toBe(200);
    const leak = r.body.data.followups.filter((f) => f.LeadId === id.L09 || /^AM-L09 /.test(f.LeadName ?? ""));
    expect(leak).toEqual([]);
  });

  it("her Calls drill lists no AM-L09 row and counts it as hidden (or the report is not hers: 403)", async () => {
    const r = await post("kasak", "/api/reports/salesRows", {
      GroupBy: "team", Metric: "call", PersonId: id.users.kasak, FromDate: day(-7), ToDate: day(0),
    });
    if (r.status === 403) {
      // Sales Executive holds no sales_reports module on TestCRM: refused outright.
      expect(isRefusal(r)).toBe(true);
      return;
    }
    expect(r.status).toBe(200);
    expect(r.body.data.rows.filter((x) => /^AM-L09 /.test(x.LeadName ?? ""))).toEqual([]);
    expect(r.body.data.hiddenCount).toBeGreaterThanOrEqual(1);
  });

  it("AM-L05 (unassigned by a manager) is 404 for its logger (F13)", () =>
    expectHidden("kasak", "/api/leads/fetchLeadDetail", "LeadId", id.L05));
});

// ---------------------------------------------------------------------------
describe("nitin on AM-C01, which he logged and gave to vinod", () => {
  it("detail is 404, the same as a missing id", () => expectHidden("nitin", "/api/tickets/fetchTicketDetail", "TicketId", id.C01));

  const writes = () => [
    ["setTicketStatus", "/api/tickets/setTicketStatus", { TicketId: id.C01, StatusId: lk.ticketOnHold ?? lk.ticketOpen, Remarks: "AM live" }],
    ["resolveTicket", "/api/tickets/resolveTicket", { TicketId: id.C01, ResolutionId: lk.resolutionId, Remarks: "AM live" }],
    ["closeTicket", "/api/tickets/closeTicket", { TicketId: id.C01, ResolutionId: lk.resolutionId, Remarks: "AM live" }],
    ["rejectTicket", "/api/tickets/rejectTicket", { TicketId: id.C01, Remarks: "AM live" }],
    ["reopenTicket", "/api/tickets/reopenTicket", { TicketId: id.C01, Remarks: "AM live" }],
    ["transferTicket", "/api/tickets/transferTicket", { TicketId: id.C01, ToUserId: id.users.nitin, ReasonId: lk.reasonId, Remarks: "AM live" }],
    ["bulkTransferTickets", "/api/tickets/bulkTransferTickets", { TicketIds: [id.C01], ToUserId: id.users.nitin, ReasonId: lk.reasonId, Remarks: "AM live" }],
    ["escalateTicket", "/api/tickets/escalateTicket", { TicketId: id.C01, ToUserId: id.users.rohit, Remarks: "AM live" }],
    ["deleteTicket", "/api/tickets/deleteTicket", { Id: id.C01 }],
    ["logCall", "/api/calls/logCall", { TicketId: id.C01, Direction: "out", Notes: "AM live" }],
    ["fetchCalls", "/api/calls/fetchCalls", { TicketId: id.C01 }],
    ["attachment list", "/api/attachments/fetch", { Entity: "ticket", EntityId: id.C01 }],
  ];
  it("every write and record read is refused with no data", async () => {
    for (const [name, path, body] of writes()) {
      const r = await post("nitin", path, body);
      expect({ name, refused: isRefusal(r), status: r.status }).toEqual({ name, refused: true, status: r.status });
    }
  });

  it("attachment upload is refused", async () => {
    const r = await c.as("nitin").upload("/api/attachments/save", { Entity: "ticket", EntityId: id.C01 });
    expect(isRefusal(r)).toBe(true);
  });

  it("escalation targets for the complaint are empty", async () => {
    const r = await post("nitin", "/api/tickets/fetchEscalationTargets", { TicketId: id.C01 });
    expect(r.status).toBe(200);
    expect(r.body.data.users).toEqual([]);
  });

  it("Logged by me holds one line with exactly the twelve fields, Id null", async () => {
    const r = await post("nitin", "/api/tickets/fetchLoggedByMe", { SearchTerm: "AM-C01", PageSize: 50 });
    expect(r.status).toBe(200);
    const rows = r.body.data.rows.filter((x) => /^AM-C01 /.test(x.Subject ?? ""));
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
  it("AM-C03 (unassigned by a manager) is 404 for its logger (D15)", () =>
    expectHidden("nitin", "/api/tickets/fetchTicketDetail", "TicketId", id.C03));

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
});

// ---------------------------------------------------------------------------
describe("vinod, holder of AM-C01", () => {
  it("AM-C13's linked lead (roshan's) is blanked (F24)", async () => {
    const r = await post("vinod", "/api/tickets/fetchTicketDetail", { TicketId: id.C13 });
    expect(r.status).toBe(200);
    expect(r.body.data.ticket.LinkedLeadId).toBeNull();
    expect(r.body.data.linkedLead).toBeNull();
  });

  const reassign = (TicketId, ToUserId) => post("vinod", "/api/tickets/transferTicket", {
    TicketId, ToUserId, ReasonId: lk.reasonId, Remarks: "AM live",
  });

  it("cannot reassign his resolved AM-C05 (F26)", async () => {
    const r = await reassign(id.C05, id.users.vivek);
    expect(r.status).toBe(403);
    expect(r.body.message).toBe("Only a manager can reassign a closed record");
  });

  it.each(["kasak", "hr", "gone"])("cannot hand AM-C01 to %s, who cannot work it (F5)", async (who) => {
    const r = await reassign(id.C01, id.users[who]);
    expect(r.status).toBe(403);
    expect(r.body.message).toBe("You cannot assign records to that person");
  });

  it("cannot unassign AM-C01 (a manager's act)", async () => {
    const r = await reassign(id.C01, null);
    expect(r.status).toBe(403);
    expect(r.body.message).toBe("Only a manager can leave a record unassigned");
  });
});

describe("walls", () => {
  it("prasant: AM-C06's closed escalation gives nothing (F23)", () =>
    expectHidden("prasant", "/api/tickets/fetchTicketDetail", "TicketId", id.C06));

  it("pooja (North Delhi): AM-C01 is 404", () => expectHidden("pooja", "/api/tickets/fetchTicketDetail", "TicketId", id.C01));

  it("ndmgr (North Delhi manager): AM-C01 and AM-L01 are 404", async () => {
    await expectHidden("ndmgr", "/api/tickets/fetchTicketDetail", "TicketId", id.C01);
    await expectHidden("ndmgr", "/api/leads/fetchLeadDetail", "LeadId", id.L01);
  });

  it("am_hr (no complaints module) gets no complaint rows or figures (F6)", async () => {
    const list = await post("hr", "/api/tickets/fetchTickets", { PageSize: 200 });
    expect(isRefusal(list) || (list.status === 200 && list.body.data.tickets.length === 0)).toBe(true);

    const dash = await post("hr", "/api/reports/getDashboard", {});
    expect(isRefusal(dash)
      || (dash.status === 200 && dash.body.data.quarterlyActivity.every((q) => !q.Tickets && !q.Calls))).toBe(true);

    const cust = await post("hr", "/api/customers/fetchCustomerDetail", { CustomerId: id.customers.HO });
    expect(isRefusal(cust)
      || (cust.status === 200 && cust.body.data.tickets.length === 0 && !cust.body.data.customer.TotalTickets)).toBe(true);
  });

  it("am_readonly's assign list has nobody from HEAD OFFICE except his manager", async () => {
    const r = await post("readonly", "/api/users/fetchAssignableUsers", { Module: "complaints" });
    expect(r.status).toBe(200);
    const headOffice = r.body.data.users.filter((u) => Number(u.BranchId) === 1).map((u) => u.Id);
    expect(headOffice.filter((x) => x !== id.users.amit)).toEqual([]);
  });
});

describe("result leads cannot be moved by staff (scenario 18)", () => {
  it("kasak bulk-reassigning her lost AM-L02 and won AM-L08 is 403 and nothing moves", async () => {
    const r = await post("kasak", "/api/leads/bulkTransferLeads", {
      LeadIds: [id.L02, id.L08], ToUserId: id.users.roshan, ReasonId: lk.reasonId, Remarks: "AM live",
    });
    expect(r.status).toBe(403);
    expect(r.body.message).toMatch(/\(\d+ of 2 refused\)$/);
    for (const LeadId of [id.L02, id.L08]) {
      const d = await post("amit", "/api/leads/fetchLeadDetail", { LeadId });
      expect(d.body.data.lead.OwnerId).toBe(id.users.kasak);
    }
  });
});

describe("a delegated follow-up seen by a team lead (scenario 19, D5)", () => {
  it("stl sees am_field's visit on AM-L01 as Via 3 without the mobile, and cannot complete it", async () => {
    const r = await post("stl", "/api/followups/fetchFollowups", { Status: "open", PageSize: 200 });
    expect(r.status).toBe(200);
    const row = r.body.data.followups.find((f) => f.LeadId === id.L01 && f.AssignedTo === id.users.field);
    expect(row).toBeDefined();
    expect(row.Via).toBe(3);
    expect(row.LeadMobile).toBeNull();
    const done = await post("stl", "/api/followups/completeFollowUp", { Id: row.Id, Remarks: "AM live" });
    expect(done.status).toBe(403);
    expect(done.body.data ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Positive cases: allowed things work, or the refusals above prove nothing.
describe("allowed", () => {
  it("rohit opens AM-C01 (his team) and AM-C04 (escalated to him)", async () => {
    expect(await opens("rohit", "/api/tickets/fetchTicketDetail", "TicketId", id.C01)).toBe(200);
    expect(await opens("rohit", "/api/tickets/fetchTicketDetail", "TicketId", id.C04)).toBe(200);
  });

  it("neha and amit open every HEAD OFFICE complaint and lead", async () => {
    const complaints = Object.keys(id).filter((k) => /^C\d\d$/.test(k) && !["C16", "C19"].includes(k));
    const leads = Object.keys(id).filter((k) => /^L\d\d$/.test(k));
    for (const who of ["neha", "amit"]) {
      const shut = [];
      for (const k of complaints) if (await opens(who, "/api/tickets/fetchTicketDetail", "TicketId", id[k]) !== 200) shut.push(k);
      for (const k of leads) if (await opens(who, "/api/leads/fetchLeadDetail", "LeadId", id[k]) !== 200) shut.push(k);
      expect({ who, shut }).toEqual({ who, shut: [] });
    }
  });

  it("vikram opens AM-C16 (North Delhi)", async () => {
    expect(await opens("vikram", "/api/tickets/fetchTicketDetail", "TicketId", id.C16)).toBe(200);
  });

  it("stl's lead list holds am_field's unassigned AM-L07", async () => {
    const r = await post("stl", "/api/leads/fetchLeads", { SearchTerm: "AM-L07", PageSize: 50 });
    expect(r.status).toBe(200);
    expect(r.body.data.leads.map((l) => l.Id)).toContain(id.L07);
  });

  it("nitin's assign list holds the complaint workers of his office, nobody else", async () => {
    const r = await post("nitin", "/api/users/fetchAssignableUsers", { Module: "complaints" });
    expect(r.status).toBe(200);
    const got = r.body.data.users.map((u) => u.Id);
    for (const who of ["vinod", "vivek", "prasant", "rohit", "neha", "amit", "imran", "vikram"]) {
      expect({ who, listed: got.includes(id.users[who]) }).toEqual({ who, listed: true });
    }
    for (const who of ["kasak", "hr", "gone", "pooja"]) {
      expect({ who, listed: got.includes(id.users[who]) }).toEqual({ who, listed: false });
    }
  });

  it("imran (Can assign to: Company) can assign to pooja", async () => {
    const r = await post("imran", "/api/users/fetchAssignableUsers", { Module: "complaints" });
    expect(r.status).toBe(200);
    expect(r.body.data.users.map((u) => u.Id)).toContain(id.users.pooja);
  });

  it("every assign-list row has exactly the ten documented fields; AwayToday is a boolean", async () => {
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
