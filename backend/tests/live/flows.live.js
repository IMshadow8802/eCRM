// tests/live/flows.live.js — the scenario rows of spec §7, end to end (Task 28).
//
// MUTATING, but only this run's records (fixtures.js createRun(), fresh per
// run), never the static 136 rows: runs repeat back to back with no re-seed.
// Runs in order: each `it` builds on the ones before it. Records it creates
// are logged by personas (subjects "<run tag>-Fnn ..."), so 137 removes them.

const { live, isRefusal, lookups, noticeMark, noticesSince, saveUser, MISSING_ID, day } = require("./client");
const { currentRun, runIds } = require("./fixtures");

const c = live();
let id;
let lk;
let run;
let name; // persona -> FullName

beforeAll(async () => {
  run = await currentRun();
  id = runIds(run, await c.ids());
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
const logComplaint = (who, key, title, AssignedTo = null) => post(who, "/api/tickets/saveTicket", {
  CustomerId: id.customers.HO, Subject: `${run.tag}-${key} ${title}`, AssignedTo,
});
/** Status + the server's sentence, so a failed setup step prints why. */
const said = (r) => ({ status: r.status, message: r.body?.message });

/**
 * The body the web sends for "Create quotation" on a lead
 * (web/src/pages/Sales/Quotations/quoteForm.js draftBodyFromLead): the lead's
 * customer details, the branch's letterhead from ensureQuoteProfile, one line.
 * sp_SaveQuotation needs ToName ("Customer name is required").
 */
const draftBody = (lead, profile) => ({
  Id: 0,
  LeadId: lead.Id,
  TemplateCode: profile?.DefaultTemplate || "classic",
  QuoteDate: day(0),
  ValidTill: day(15),
  Subject: "AM live quote",
  ToName: lead.Name,
  ToCompany: lead.Company ?? "",
  ToMobile: lead.MobileNo ?? "",
  ToEmail: lead.Email ?? "",
  ToAddress: lead.Address ?? "",
  ToCity: lead.City ?? "",
  ToStateCode: "",
  ToPincode: lead.Pincode ?? "",
  ToGSTIN: "",
  Company: {
    name: profile?.CompanyName ?? "", address: profile?.Address ?? "", city: profile?.City ?? "",
    stateCode: profile?.StateCode ?? "", pincode: profile?.Pincode ?? "", gstin: profile?.GSTIN ?? "",
    phone: profile?.Phone ?? "", email: profile?.Email ?? "", website: profile?.Website ?? "",
    bank: profile?.BankDetails ?? "", signatory: profile?.SignatoryName ?? "",
    logoAttachmentId: profile?.LogoAttachmentId ?? null, headerAttachmentId: profile?.HeaderAttachmentId ?? null,
    showLogo: true, showHeader: true, accent: profile?.AccentColor || "#1e3a8a",
  },
  Content: { intro: profile?.DefaultIntro ?? "", terms: profile?.DefaultTerms ?? "", notes: "", sections: [] },
  Lines: [{
    productId: null, description: "AM panel", hsn: "", qty: 1, unit: "", rate: 100,
    discountType: "pct", discountValue: "", taxPct: 18,
  }],
});

const outcome = (r) => ({ status: r.status, message: r.body?.message, refused: isRefusal(r) });

/** [name, path, body(missing?), expected]: real id and MISSING_ID refused identically. */
async function expectAllRefused(who, cases) {
  for (const [label, path, body, expected] of cases) {
    const r = await post(who, path, body(false));
    const missing = await post(who, path, body(true));
    expect({ label, ...outcome(r) }).toEqual({ label, ...expected, refused: true });
    expect({ label, ...outcome(missing) }).toEqual({ label, ...outcome(r) });
  }
}

let handed = {}; // what scenario 6 handed to roshan: { QuotationId, followUpId }

describe("scenarios, in order", () => {
  it("1. nitin logs and routes to vinod", async () => {
    const r = await logComplaint("nitin", "F01", "Logged and routed", id.users.vinod);
    expect(r.status).toBe(200);
    expect(r.body.message).toBe(`Logged and assigned to ${name.vinod}`);
    const newId = r.body.data.Id;
    expect((await ticket("vinod", newId)).status).toBe(200);
    expect((await ticket("nitin", newId)).status).toBe(404);
    const mine = await post("nitin", "/api/tickets/fetchLoggedByMe", { SearchTerm: `${run.tag}-F01`, PageSize: 50 });
    expect(mine.body.data.rows.some((x) => x.Subject === `${run.tag}-F01 Logged and routed`)).toBe(true);
  });

  it("2. vinod reassigns C01 to vivek; due time unchanged; vivek is told", async () => {
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

  it("4. rohit bulk-reassigns C08..C12 to vivek; one notice each", async () => {
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
    const r = await logComplaint("imran", "F05", "Cross-office", id.users.pooja);
    expect(r.status).toBe(200);
    const newId = r.body.data.Id;
    expect(Number((await asAmit(newId)).BranchId)).toBe(6);
    expect((await ticket("ndmgr", newId)).status).toBe(200);
    expect((await ticket("vikram", newId)).status).toBe(200);
    expect((await ticket("neha", newId)).status).toBe(404);
    expect((await sendBack("pooja", newId)).status).toBe(200);
    expect((await asAmit(newId)).AssignedTo).toBe(id.users.imran);
  });

  it("6 + 19. kasak quotes L01 and hands it to roshan; her follow-up moves, am_field's stays", async () => {
    const kasak = c.as("kasak");
    const prof = await kasak.post("/api/quotations/ensureQuoteProfile", { LeadId: id.L01 });
    expect(said(prof)).toMatchObject({ status: 200 });
    const lead = (await kasak.post("/api/leads/fetchLeadDetail", { LeadId: id.L01 })).body.data.lead;
    const q = await kasak.post("/api/quotations/saveQuotation", draftBody(lead, prof.body.data.profile));
    expect(said(q)).toMatchObject({ status: 200 }); // a failure shows the server's sentence
    const QuotationId = q.body.data.Id;
    expect(QuotationId).toBeGreaterThan(0);

    const fus = (await post("amit", "/api/leads/fetchLeadDetail", { LeadId: id.L01 })).body.data.followups;
    const kasakFu = fus.find((f) => f.Id === run.followUp("L01_kasak_open").id && f.Status === "open" && f.AssignedTo === id.users.kasak);
    const fieldFu = fus.find((f) => f.Id === run.followUp("L01_field_visit").id && f.Status === "open" && f.AssignedTo === id.users.field);
    expect(kasakFu && fieldFu).toBeTruthy();

    const mark = await noticeMark(c, "roshan");
    const r = await kasak.post("/api/leads/transferLead", {
      LeadId: id.L01, ToUserId: id.users.roshan, ReasonId: lk.reasonId, Remarks: "AM live: handing over",
    });
    expect(said(r)).toMatchObject({ status: 200 });

    expect((await post("roshan", "/api/leads/fetchLeadDetail", { LeadId: id.L01 })).status).toBe(200);
    expect((await post("roshan", "/api/quotations/fetchQuotationDetail", { QuotationId })).status).toBe(200);
    const after = (await post("amit", "/api/leads/fetchLeadDetail", { LeadId: id.L01 })).body.data.followups;
    expect(after.find((f) => f.Id === kasakFu.Id).AssignedTo).toBe(id.users.roshan);
    expect(after.find((f) => f.Id === fieldFu.Id).AssignedTo).toBe(id.users.field);

    expect((await kasak.post("/api/leads/fetchLeadDetail", { LeadId: id.L01 })).status).toBe(404);
    expect((await kasak.post("/api/quotations/fetchQuotationDetail", { QuotationId })).status).toBe(404);
    expect((await kasak.post("/api/followups/fetchFollowups", { LeadId: id.L01 })).status).toBe(404);
    expect((await noticesSince(c, "roshan", mark, "lead_assigned")).some((n) => Number(n.EntityId) === id.L01)).toBe(true);
    handed = { QuotationId, followUpId: kasakFu.Id };
  });

  it("6b. after the hand-over kasak can act on nothing she gave away: 404 as for a missing id", async () => {
    if (!handed.QuotationId || !handed.followUpId) {
      throw new Error("6b needs scenario 6 (quotation + hand-over) to have passed; fix that failure first.");
    }
    const Q = (m) => (m ? MISSING_ID : handed.QuotationId);
    const F = (m) => (m ? MISSING_ID : handed.followUpId);
    const Q_404 = { status: 404, message: "Quotation not found" };
    const FU_404 = { status: 404, message: "Follow-up not found" };
    await expectAllRefused("kasak", [
      ["quotation detail", "/api/quotations/fetchQuotationDetail", (m) => ({ QuotationId: Q(m) }), Q_404],
      ["finalise", "/api/quotations/finaliseQuotation", (m) => ({ QuotationId: Q(m) }), Q_404],
      ["revise", "/api/quotations/reviseQuotation", (m) => ({ QuotationId: Q(m) }), Q_404],
      ["reject", "/api/quotations/rejectQuotation", (m) => ({ QuotationId: Q(m), Remarks: "AM live" }), Q_404],
      ["delete", "/api/quotations/deleteQuotation", (m) => ({ QuotationId: Q(m) }), Q_404],
      ["edit", "/api/quotations/saveQuotation", (m) => ({ Id: Q(m), Lines: [] }), Q_404],
      ["complete follow-up", "/api/followups/completeFollowUp", (m) => ({ Id: F(m), Remarks: "AM live" }), FU_404],
      ["skip follow-up", "/api/followups/skipFollowUp", (m) => ({ Id: F(m), Remarks: "AM live" }), FU_404],
      ["delete follow-up", "/api/followups/deleteFollowup", (m) => ({ Id: F(m) }), FU_404],
      ["reschedule on the lead", "/api/followups/scheduleFollowUp",
        (m) => ({ LeadId: m ? MISSING_ID : id.L01, Type: "call", DueAt: `${day(2)}T11:00:00` }), { status: 404, message: "Lead not found" }],
    ]);
  });

  it("F2 + 9. am_field logs a call on L06, hands it to roshan: stl's drill counts it hidden; neha's total is the same", async () => {
    const call = await post("field", "/api/calls/logCall", { LeadId: id.L06, Direction: "out", Notes: "AM live: F2 call" });
    expect(call.status).toBe(200);
    const moved = await post("field", "/api/leads/transferLead", {
      LeadId: id.L06, ToUserId: id.users.roshan, ReasonId: lk.reasonId, Remarks: "AM live: F2 hand-over",
    });
    expect(moved.status).toBe(200);
    expect((await post("stl", "/api/leads/fetchLeadDetail", { LeadId: id.L06 })).status).toBe(404);

    const drill = { GroupBy: "team", Metric: "call", PersonId: id.users.field, FromDate: day(-7), ToDate: day(0) };
    const stl = await post("stl", "/api/reports/salesRows", drill);
    expect(stl.status).toBe(200);
    expect(stl.body.data.rows.filter((x) => x.LeadName === run.lead("L06").name)).toEqual([]);
    expect(stl.body.data.hiddenCount).toBeGreaterThanOrEqual(1);
    expect(stl.body.data.total).toBe(stl.body.data.rows.length + stl.body.data.hiddenCount);

    const neha = await post("neha", "/api/reports/salesRows", drill);
    expect(neha.status).toBe(200);
    expect(neha.body.data.total).toBe(stl.body.data.total); // scenario 9: one number, whoever looks
    expect(neha.body.data.hiddenCount).toBe(0);
    expect(neha.body.data.rows.some((x) => x.LeadName === run.lead("L06").name)).toBe(true);
  });

  it("7. nitin logs an unassigned complaint: logger and office managers see it; vinod does not", async () => {
    const r = await logComplaint("nitin", "F07", "Unassigned");
    expect(r.status).toBe(200);
    const newId = r.body.data.Id;
    for (const who of ["nitin", "neha", "amit"]) expect({ who, s: (await ticket(who, newId)).status }).toEqual({ who, s: 200 });
    expect((await ticket("vinod", newId)).status).toBe(404);
    expect((await reassign("nitin", newId, id.users.vinod)).status).toBe(200);
  });

  it("11-12. rohit opens escalated C04; amit reassigns it to prasant: rohit loses it, escalation cleared", async () => {
    expect((await ticket("rohit", id.C04)).status).toBe(200);
    expect((await reassign("amit", id.C04, id.users.prasant)).status).toBe(200);
    expect((await ticket("rohit", id.C04)).status).toBe(404);
    expect((await asAmit(id.C04)).EscalatedTo).toBeNull();
  });

  it("13. amit takes C15 from vinod to rohit: vinod is told who moved it; rohit's send back names amit", async () => {
    const mark = await noticeMark(c, "vinod");
    expect((await reassign("amit", id.C15, id.users.rohit)).status).toBe(200);
    const moved = await noticesSince(c, "vinod", mark, "ticket_moved_away");
    expect(moved.some((n) => Number(n.ActorUserId) === id.users.amit || (n.Body ?? "").includes(name.amit))).toBe(true);
    expect((await ticket("rohit", id.C15)).body.data.ticket.SendBackToName).toBe(name.amit);
  });

  it("14. vinod cannot reopen his own C05; neha can", async () => {
    const own = await post("vinod", "/api/tickets/reopenTicket", { TicketId: id.C05, Remarks: "AM live: not fixed" });
    expect(own.status).toBe(403);
    expect(own.body.message).toBe("Reopening requires a manager");
    const r = await post("neha", "/api/tickets/reopenTicket", { TicketId: id.C05, Remarks: "AM live: not fixed" });
    expect(r.status).toBe(200);
  });

  it("16. amit unassigns C11 (nitin logged it): nitin does not get it back", async () => {
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

  it("D27 / N4. neha reopens C07 (held by inactive am_gone): unassigned, office managers told", async () => {
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

  it.each([
    ["nitin", "ticket", "C14"],
    ["kasak", "lead", "L03"],
  ])("a file on a record %s cannot see does not download: 404 as for a missing file", async (who, Entity, tag) => {
    const up = await c.as("amit").upload("/api/attachments/save", { Entity, EntityId: id[tag] });
    expect(said(up)).toMatchObject({ status: 201 }); // sp_SaveAttachment answers 201 Created
    const r = await post(who, "/api/attachments/download", { Id: up.body.data.attachmentId });
    const missing = await post(who, "/api/attachments/download", { Id: MISSING_ID });
    expect(r.status).toBe(404);
    expect(isRefusal(r)).toBe(true);
    expect({ status: r.status, message: r.body?.message }).toEqual({ status: missing.status, message: missing.body?.message });
  });

  // Review Focus 3. Last: it deactivates nitin for a moment.
  it("send back to a giver deactivated meanwhile is refused with the gate-4 sentence", async () => {
    const r = await logComplaint("nitin", "F99", "Send-back race", id.users.vivek);
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
