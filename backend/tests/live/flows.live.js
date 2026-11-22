// tests/live/flows.live.js — the scenario rows of spec §7, end to end (Task 28).
//
// MUTATING. Needs a fresh seed (137 then 136 on TestCRM) and runs in order:
// each `it` builds on the ones before it. Run matrix.live.js and
// legacy.live.js first; re-seed after. Records it creates are logged by
// personas (subjects "AM-Fnn ..."), so 137 removes them.

const { live, isRefusal, lookups, noticeMark, noticesSince, saveUser } = require("./client");

const c = live();
let id;
let lk;
let name; // persona -> FullName

beforeAll(async () => {
  id = await c.ids();
  lk = await lookups(c);
  name = Object.fromEntries(Object.entries(id.people).map(([k, p]) => [k, p.FullName]));
});

const post = (who, path, body) => c.as(who).post(path, body);
const ticket = (who, TicketId) => post(who, "/api/tickets/fetchTicketDetail", { TicketId });
const asAmit = async (TicketId) => (await ticket("amit", TicketId)).body.data.ticket;
const reassign = (who, TicketId, ToUserId) => post(who, "/api/tickets/transferTicket", {
  TicketId, ToUserId, ReasonId: lk.reasonId, Remarks: "AM live: reassign",
});
const sendBack = (who, TicketId) => post(who, "/api/tickets/transferTicket", {
  TicketId, SendBack: true, Remarks: "AM live: not mine",
});
const logComplaint = (who, Subject, AssignedTo = null) => post(who, "/api/tickets/saveTicket", {
  CustomerId: id.customers.HO, Subject, AssignedTo,
});

describe("scenarios, in order", () => {
  it("1. nitin logs and routes to vinod", async () => {
    const r = await logComplaint("nitin", "AM-F01 Logged and routed", id.users.vinod);
    expect(r.status).toBe(200);
    expect(r.body.message).toBe(`Logged and assigned to ${name.vinod}`);
    const newId = r.body.data.Id;
    expect((await ticket("vinod", newId)).status).toBe(200);
    expect((await ticket("nitin", newId)).status).toBe(404);
    const mine = await post("nitin", "/api/tickets/fetchLoggedByMe", { SearchTerm: "AM-F01", PageSize: 50 });
    expect(mine.body.data.rows.some((x) => /^AM-F01 /.test(x.Subject))).toBe(true);
  });

  it("2. vinod reassigns AM-C01 to vivek; due time unchanged; vivek is told", async () => {
    const before = await asAmit(id.C01);
    const mark = await noticeMark(c, "vivek");
    const r = await reassign("vinod", id.C01, id.users.vivek);
    expect(r.status).toBe(200);
    expect(r.body.message).toBe("Complaint reassigned successfully");
    expect((await ticket("vivek", id.C01)).status).toBe(200);
    expect((await ticket("vinod", id.C01)).status).toBe(404);
    expect((await asAmit(id.C01)).DueAt).toBe(before.DueAt);
    const told = await noticesSince(c, "vivek", mark, "ticket_assigned");
    expect(told.some((n) => Number(n.EntityId) === id.C01)).toBe(true);
  });

  it("3. vivek sends back to vinod; vinod's button names nitin; vinod sends back to nitin", async () => {
    const r = await sendBack("vivek", id.C01);
    expect(r.status).toBe(200);
    expect(r.body.message).toBe("Complaint sent back");
    expect((await asAmit(id.C01)).AssignedTo).toBe(id.users.vinod);
    const v = await ticket("vinod", id.C01);
    expect(v.body.data.ticket.SendBackToName).toBe(name.nitin);
    expect((await sendBack("vinod", id.C01)).status).toBe(200);
    expect((await asAmit(id.C01)).AssignedTo).toBe(id.users.nitin);
  });

  it("4. rohit bulk-reassigns AM-C08..AM-C12 to vivek; one notice each", async () => {
    const marks = { vinod: await noticeMark(c, "vinod"), vivek: await noticeMark(c, "vivek") };
    const r = await post("rohit", "/api/tickets/bulkTransferTickets", {
      TicketIds: [id.C08, id.C09, id.C10, id.C11, id.C12], ToUserId: id.users.vivek,
      ReasonId: lk.reasonId, Remarks: "AM live: vinod away",
    });
    expect(r.status).toBe(200);
    for (const who of ["vinod", "vivek"]) {
      const bulk = (await noticesSince(c, who, marks[who])).filter((n) => /bulk/.test(n.Type ?? ""));
      expect({ who, notices: bulk.length }).toEqual({ who, notices: 1 });
    }
  });

  it("5. imran logs at HEAD OFFICE for pooja: it moves to North Delhi; pooja sends it back", async () => {
    const r = await logComplaint("imran", "AM-F05 Cross-office", id.users.pooja);
    expect(r.status).toBe(200);
    const newId = r.body.data.Id;
    expect(Number((await asAmit(newId)).BranchId)).toBe(6);
    expect((await ticket("ndmgr", newId)).status).toBe(200);
    expect((await ticket("vikram", newId)).status).toBe(200);
    expect((await ticket("neha", newId)).status).toBe(404);
    expect((await sendBack("pooja", newId)).status).toBe(200);
    expect((await asAmit(newId)).AssignedTo).toBe(id.users.imran);
  });

  it("6 + 19. kasak quotes AM-L01 and hands it to roshan; her follow-up moves, am_field's stays", async () => {
    const kasak = c.as("kasak");
    expect((await kasak.post("/api/quotations/ensureQuoteProfile", { LeadId: id.L01 })).status).toBe(200);
    const q = await kasak.post("/api/quotations/saveQuotation", {
      LeadId: id.L01, Subject: "AM live quote", Lines: [{ description: "AM panel", qty: 1, rate: 100, taxPct: 18 }],
    });
    expect(q.status).toBe(200);
    const QuotationId = q.body.data.Id;

    const fus = (await post("amit", "/api/leads/fetchLeadDetail", { LeadId: id.L01 })).body.data.followups;
    const kasakFu = fus.find((f) => f.Status === "open" && f.AssignedTo === id.users.kasak);
    const fieldFu = fus.find((f) => f.Status === "open" && f.AssignedTo === id.users.field);
    expect(kasakFu && fieldFu).toBeTruthy();

    const mark = await noticeMark(c, "roshan");
    const r = await kasak.post("/api/leads/transferLead", {
      LeadId: id.L01, ToUserId: id.users.roshan, ReasonId: lk.reasonId, Remarks: "AM live: handing over",
    });
    expect(r.status).toBe(200);

    expect((await post("roshan", "/api/leads/fetchLeadDetail", { LeadId: id.L01 })).status).toBe(200);
    expect((await post("roshan", "/api/quotations/fetchQuotationDetail", { QuotationId })).status).toBe(200);
    const after = (await post("amit", "/api/leads/fetchLeadDetail", { LeadId: id.L01 })).body.data.followups;
    expect(after.find((f) => f.Id === kasakFu.Id).AssignedTo).toBe(id.users.roshan);
    expect(after.find((f) => f.Id === fieldFu.Id).AssignedTo).toBe(id.users.field);

    expect((await kasak.post("/api/leads/fetchLeadDetail", { LeadId: id.L01 })).status).toBe(404);
    expect((await kasak.post("/api/quotations/fetchQuotationDetail", { QuotationId })).status).toBe(404);
    expect((await kasak.post("/api/followups/fetchFollowups", { LeadId: id.L01 })).status).toBe(404);
    expect((await noticesSince(c, "roshan", mark, "lead_assigned")).some((n) => Number(n.EntityId) === id.L01)).toBe(true);
  });

  it("7. nitin logs an unassigned complaint: logger and office managers see it; vinod does not", async () => {
    const r = await logComplaint("nitin", "AM-F07 Unassigned");
    expect(r.status).toBe(200);
    const newId = r.body.data.Id;
    for (const who of ["nitin", "neha", "amit"]) expect({ who, s: (await ticket(who, newId)).status }).toEqual({ who, s: 200 });
    expect((await ticket("vinod", newId)).status).toBe(404);
    expect((await reassign("nitin", newId, id.users.vinod)).status).toBe(200);
  });

  it("11-12. rohit opens escalated AM-C04; amit reassigns it to prasant: rohit loses it, escalation cleared", async () => {
    expect((await ticket("rohit", id.C04)).status).toBe(200);
    expect((await reassign("amit", id.C04, id.users.prasant)).status).toBe(200);
    expect((await ticket("rohit", id.C04)).status).toBe(404);
    expect((await asAmit(id.C04)).EscalatedTo).toBeNull();
  });

  it("13. amit takes AM-C15 from vinod to rohit: vinod is told who moved it; rohit's send back names amit", async () => {
    const mark = await noticeMark(c, "vinod");
    expect((await reassign("amit", id.C15, id.users.rohit)).status).toBe(200);
    const moved = await noticesSince(c, "vinod", mark, "ticket_moved_away");
    expect(moved.some((n) => Number(n.ActorUserId) === id.users.amit || (n.Body ?? "").includes(name.amit))).toBe(true);
    expect((await ticket("rohit", id.C15)).body.data.ticket.SendBackToName).toBe(name.amit);
  });

  it("14. vinod cannot reopen his own AM-C05; neha can", async () => {
    const own = await post("vinod", "/api/tickets/reopenTicket", { TicketId: id.C05, Remarks: "AM live: not fixed" });
    expect(own.status).toBe(403);
    expect(own.body.message).toBe("Reopening requires a manager");
    const r = await post("neha", "/api/tickets/reopenTicket", { TicketId: id.C05, Remarks: "AM live: not fixed" });
    expect(r.status).toBe(200);
  });

  it("16. amit unassigns AM-C11 (nitin logged it): nitin does not get it back", async () => {
    const r = await reassign("amit", id.C11, null);
    expect(r.status).toBe(200);
    expect(r.body.message).toBe("Complaint unassigned");
    expect((await ticket("nitin", id.C11)).status).toBe(404);
  });

  it("17. vinod moved to a role without complaints: stranded count, no complaints, rohit told", async () => {
    const original = id.people.vinod.GroupId;
    const mark = await noticeMark(c, "rohit");
    try {
      const r = await saveUser(c, "vinod", { GroupId: id.people.hr.GroupId });
      expect(r.status).toBe(200);
      expect(r.body.data.stranded.complaints).toBeGreaterThan(0);
      expect((await post("vinod", "/api/tickets/fetchTickets", {})).status).toBe(403);
      expect((await noticesSince(c, "rohit", mark, "stranded_work")).length).toBeGreaterThan(0);
    } finally {
      const back = await saveUser(c, "vinod", { GroupId: original });
      expect(back.status).toBe(200);
    }
  });

  it("D27 / N4. neha reopens AM-C07 (held by inactive am_gone): unassigned, office managers told", async () => {
    const marks = { amit: await noticeMark(c, "amit"), neha: await noticeMark(c, "neha") };
    const r = await post("neha", "/api/tickets/reopenTicket", { TicketId: id.C07, Remarks: "AM live: back again" });
    expect(r.status).toBe(200);
    expect((await asAmit(id.C07)).AssignedTo).toBeNull();
    const told = [
      ...(await noticesSince(c, "amit", marks.amit, "ticket_reopen_unassigned")),
      ...(await noticesSince(c, "neha", marks.neha, "ticket_reopen_unassigned")),
    ];
    expect(told.length).toBeGreaterThan(0);
  });

  it("a file on a complaint he cannot see does not download for nitin", async () => {
    const up = await c.as("amit").upload("/api/attachments/save", { Entity: "ticket", EntityId: id.C14 });
    expect(up.status).toBe(200);
    const r = await post("nitin", "/api/attachments/download", { Id: up.body.data.attachmentId });
    expect(isRefusal(r)).toBe(true);
  });

  // Review Focus 3. Last: it deactivates nitin for a moment.
  it("send back to a giver deactivated meanwhile is refused with the gate-4 sentence", async () => {
    const r = await logComplaint("nitin", "AM-F99 Send-back race", id.users.vivek);
    expect(r.status).toBe(200);
    const newId = r.body.data.Id;
    try {
      expect((await saveUser(c, "nitin", { UserActive: false })).status).toBe(200);
      const back = await sendBack("vivek", newId);
      expect(back.status).toBe(400);
      expect(back.body.message).toBe(`${name.nitin} can no longer take this. Reassign it instead.`);
      expect((await asAmit(newId)).AssignedTo).toBe(id.users.vivek);
    } finally {
      expect((await saveUser(c, "nitin", { UserActive: true })).status).toBe(200);
      c.forget("nitin");
    }
  });
});
