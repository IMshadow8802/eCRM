// tests/live/fixtures.js — this run's records, made through the API.
//
// The live suites (and web/e2e global-setup.js) never touch the static 136
// rows any more: createRun() makes a fresh copy of every record the scenarios
// need, as the persona who would make it in real use, so runs can follow one
// another with no re-seed. Every record is LOGGED by a persona (137 deletes
// what a persona created) and named "AMR-<yyyymmddHHMMss>-<key> ..." so two
// runs never collide. The am_amit TestCRM proof in client.js runs before the
// first write (every as() awaits it).
//
// Shapes 136 seeds that the API cannot make in one step are made the way they
// happen in real use, and restored in `finally`:
//   C06 / C17  escalated to prasant, who is not above the holder: the holder
//              reports to prasant for the moment of the escalation.
//   C07        held + resolved by am_gone: am_gone is active for the moment
//              of being assigned and resolving, then deactivated again.
//   C14        held by am_hr (no complaints module): am_hr holds the Support
//              Agent role while it is assigned, then gets his own role back.
//   C13        nitin logs it; amit links AM-L03's copy (nitin cannot see that
//              lead, so he may not link it himself).
//   C19        logged by am_readonly for himself (a complaint lands in its
//              logger's office; nobody in office 2 but him can log there).
//   C20        held by am_readonly in office 1 (his read-only extra office:
//              Rule 3 keeps it there).
// Extra keys 136 does not have: C21 (office 6, resolved by pooja) and L10
// (am_field's lost lead), so a team lead / office-6 role has a closed record.
//
// Also creates, once per database (looked up by username first), the personas
// 136 does not seed: am_saleshead, am_supmgr, am_regmgr, am_solo.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { live, lookups, saveUser, day } = require("./client");

const pad = (n, w = 2) => String(n).padStart(w, "0");
function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Personas 136 does not seed. FullName "AM ..." + username am_... so 137 removes them. */
const EXTRA_PERSONAS = [
  { key: "saleshead", FullName: "AM Sales Head", role: "Sales Head", JobTitle: "Sales head", boss: "amit" },
  { key: "supmgr", FullName: "AM Support Manager", role: "Support Manager", JobTitle: "Support manager", boss: "amit" },
  { key: "regmgr", FullName: "AM Regional Manager", role: "Regional Manager", JobTitle: "Regional manager", boss: "amit" },
  { key: "solo", FullName: "AM Solo", role: "Sales Executive", JobTitle: "Sales executive, no manager", boss: null },
];

/** A failed set-up step names itself, the status and the server's sentence (never a body). */
function must(r, what, ok = [200, 201]) {
  if (!ok.includes(r.status)) throw new Error(`createRun: ${what} answered ${r.status}: ${r.body?.message ?? "no message"}`);
  return r.body?.data;
}

async function ensurePersonas(c, ids) {
  const amit = c.as("amit");
  const find = async () => {
    const r = await amit.post("/api/users/fetchUsers", { SearchTerm: "AM ", PageSize: 200 });
    return must(r, "fetchUsers")?.users ?? [];
  };
  let users = await find();
  const missing = EXTRA_PERSONAS.filter((p) => !users.some((u) => u.Username === `am_${p.key}`));
  if (missing.length) {
    const groups = must(await amit.post("/api/user-groups/fetchUserGroups", { PageSize: 100 }), "fetchUserGroups")?.userGroups ?? [];
    for (const p of missing) {
      const g = groups.find((x) => x.Name === p.role);
      if (!g) throw new Error(`createRun: role "${p.role}" not found on this database`);
      must(await amit.post("/api/users/saveUser", {
        Id: 0,
        Username: `am_${p.key}`,
        Password: process.env.LIVE_PASSWORD, // read at run time, never printed
        FullName: p.FullName,
        JobTitle: p.JobTitle,
        GroupId: g.Id,
        BranchId: 1,
        ReportsTo: p.boss ? ids.users[p.boss] : null,
        UserActive: true,
        PresenceExempt: true,
      }), `saveUser am_${p.key}`);
    }
    users = await find();
  }
  const out = {};
  for (const p of EXTRA_PERSONAS) {
    const u = users.find((x) => x.Username === `am_${p.key}`);
    if (!u) throw new Error(`createRun: am_${p.key} was not created`);
    out[p.key] = u.Id;
  }
  return out;
}

/** Plain data -> the object the suites use (accessors throw on an unknown key). */
function hydrate(data) {
  const get = (kind, label) => (k) => {
    const rec = data[kind][k];
    if (!rec) throw new Error(`This run has no ${label} ${k} (tests/live/fixtures.js).`);
    return rec;
  };
  return {
    ...data,
    complaint: get("complaints", "complaint"),
    lead: get("leads", "lead"),
    customer: get("customers", "customer"),
    followUp: get("followUps", "follow-up"),
  };
}

/**
 * Creates this run's records through the API and returns
 * { runId, tag, users, complaints, leads, customers, followUps,
 *   complaint(k), lead(k), customer(k), followUp(k) } — every record { id, ... }.
 */
async function createRun({ client = live() } = {}) {
  const c = client;
  const ids = await c.ids(); // the TestCRM proof, before any write
  const lk = await lookups(c);
  const lostReasons = must(await c.as("amit").post("/api/config/fetchLookups", { Kind: "lost_reason" }), "fetchLookups lost_reason")?.lookups ?? [];
  const extra = await ensurePersonas(c, ids);
  const U = { ...ids.users, ...extra };

  const runId = stamp();
  const tag = `AMR-${runId}`;
  const base = String(Math.floor(Date.now() / 1000) % 1e7).padStart(7, "0");
  const mobile = (prefix, n) => `${prefix}${base}${pad(n)}`; // ten digits, unique per run and record

  const data = { runId, tag, users: U, complaints: {}, leads: {}, customers: {}, followUps: {} };
  const as = (who) => c.as(who);

  // ---- customers: one per office case ---------------------------------------
  const CUSTOMERS = [["HO", "amit", 1, 1], ["SE", "amit", 2, 2], ["ND", "ndmgr", null, 3]];
  for (const [k, who, BranchId, n] of CUSTOMERS) {
    const name = `${tag}-Cust-${k}`;
    const m = mobile(6, n);
    const d = must(await as(who).post("/api/customers/saveCustomer", {
      Name: name, ContactPerson: "AM run contact", Mobile: m, City: "New Delhi", ...(BranchId && { BranchId }),
    }), `customer ${k}`);
    data.customers[k] = { id: d.Id, name, mobile: m };
  }
  const cust = (k) => data.customers[k].id;

  // ---- leads -------------------------------------------------------------------
  const saveLead = async (k, who, title, owner, n) => {
    const name = `${tag}-${k} ${title}`;
    const m = mobile(7, n);
    const d = must(await as(who).post("/api/leads/saveLeads", {
      Name: name, MobileNo: m, EstValue: 50000, OwnerId: owner ? U[owner] : null,
    }), `lead ${k}`);
    data.leads[k] = { id: d.Id, name, mobile: m };
    return d.Id;
  };
  const transferLead = (who, LeadId, to, Remarks) => as(who).post("/api/leads/transferLead", {
    LeadId, ToUserId: to ? U[to] : null, ReasonId: lk.reasonId, Remarks,
  });
  const schedule = async (who, LeadId, Type, at, to) => must(await as(who).post("/api/followups/scheduleFollowUp", {
    LeadId, Type, DueAt: at, AssignedTo: U[to],
  }), `follow-up on ${LeadId} by ${who}`).Id;
  const complete = async (who, Id, Remarks) => must(await as(who).post("/api/followups/completeFollowUp", { Id, Remarks }), `complete follow-up ${Id}`);
  const setLost = async (who, LeadId) => must(await as(who).post("/api/leads/setLeadStatus", {
    LeadId, StatusId: lk.leadLost, LostReasonId: lostReasons[0]?.Id ?? null,
  }), `lost ${LeadId}`);

  const L01 = await saveLead("L01", "kasak", "Rooftop solar enquiry", "kasak", 1);
  data.followUps.L01_kasak_open = { id: await schedule("kasak", L01, "call", `${day(1)}T11:00:00`, "kasak"), lead: "L01", assignedTo: "kasak", status: "open" };
  data.followUps.L01_field_visit = { id: await schedule("neha", L01, "visit", `${day(1)}T15:00:00`, "field"), lead: "L01", assignedTo: "field", scheduledBy: "neha", status: "open" };
  const l01Done = await schedule("kasak", L01, "call", `${day(1)}T10:00:00`, "kasak");
  await complete("kasak", l01Done, "AM run: customer wants a site visit");
  data.followUps.L01_kasak_done = { id: l01Done, lead: "L01", assignedTo: "kasak", status: "done" };
  must(await as("kasak").post("/api/calls/logCall", { LeadId: L01, Direction: "out", Notes: "AM run call", Duration: 120 }), "call on L01");

  const L02 = await saveLead("L02", "kasak", "Inverter quote, lost", "kasak", 2);
  await setLost("kasak", L02);
  await saveLead("L03", "roshan", "Roshan's battery lead", "roshan", 3);
  await saveLead("L04", "kasak", "Unassigned walk-in", null, 4);
  const L05 = await saveLead("L05", "kasak", "Assigned then unassigned", "roshan", 5);
  must(await transferLead("neha", L05, null, "AM run: unassigned by manager"), "unassign L05");
  await saveLead("L06", "field", "Field visit lead", "field", 6);
  await saveLead("L07", "field", "Field unassigned", null, 7);
  const L08 = await saveLead("L08", "kasak", "Solar AMC, won", "kasak", 8);
  must(await as("kasak").post("/api/leads/convertLead", { LeadId: L08, WonValue: 50000, Remarks: "AM run win" }), "convert L08");
  const L09 = await saveLead("L09", "kasak", "Handed to Roshan", "kasak", 9);
  const l09Done = await schedule("kasak", L09, "call", `${day(1)}T12:00:00`, "kasak");
  await complete("kasak", l09Done, "AM run: spoke before hand-over");
  data.followUps.L09_kasak_done = { id: l09Done, lead: "L09", assignedTo: "kasak", status: "done" };
  must(await as("kasak").post("/api/calls/logCall", { LeadId: L09, Direction: "out", Notes: "AM run call", Duration: 90 }), "call on L09");
  must(await transferLead("kasak", L09, "roshan", "AM run: handed to Roshan"), "hand L09 to roshan");
  const L10 = await saveLead("L10", "field", "Field lead, lost", "field", 10);
  await setLost("field", L10);

  // ---- complaints ----------------------------------------------------------
  const log = async (k, who, title, to, customer = "HO", n = Number(k.slice(1))) => {
    const subject = `${tag}-${k} ${title}`;
    const contact = mobile(8, n);
    const d = must(await as(who).post("/api/tickets/saveTicket", {
      CustomerId: cust(customer), Subject: subject, Contact: contact, AssignedTo: to ? U[to] : null,
    }), `complaint ${k}`);
    data.complaints[k] = { id: d.Id, subject, contact, ticketNo: d.TicketNo };
    return d.Id;
  };
  const resolve = async (who, TicketId) => must(await as(who).post("/api/tickets/resolveTicket", {
    TicketId, ResolutionId: lk.resolutionId, Remarks: "AM run: fixed",
  }), `resolve ${TicketId} as ${who}`);
  const escalate = async (who, TicketId, to) => must(await as(who).post("/api/tickets/escalateTicket", {
    TicketId, ToUserId: U[to], Remarks: "AM run: needs a senior",
  }), `escalate ${TicketId} to ${to}`);

  await log("C01", "nitin", "Inverter tripping", "vinod");
  await log("C02", "nitin", "Unassigned, with logger", null);
  const C03 = await log("C03", "nitin", "Unassigned by manager", "vinod");
  must(await as("amit").post("/api/tickets/transferTicket", {
    TicketId: C03, ToUserId: null, ReasonId: lk.reasonId, Remarks: "AM run: unassigned by manager",
  }), "unassign C03");
  const C04 = await log("C04", "nitin", "Escalated to Rohit", "vinod");
  await escalate("vinod", C04, "rohit");
  const C05 = await log("C05", "nitin", "Resolved by Vinod", "vinod");
  await resolve("vinod", C05);
  const C06 = await log("C06", "nitin", "Resolved, was escalated", "vivek");
  for (const k of ["C08", "C09", "C10", "C11", "C12"]) await log(k, "nitin", `Bulk ${k}`, "vinod");
  const C13 = await log("C13", "nitin", "Linked to L03", "vinod");
  must(await as("amit").post("/api/tickets/saveTicket", {
    Id: C13, CustomerId: cust("HO"), Subject: data.complaints.C13.subject, Contact: data.complaints.C13.contact,
    LinkedLeadId: data.leads.L03.id,
  }), "link C13 to L03");
  await log("C15", "amit", "Assigned by Amit", "vinod");
  await log("C16", "ndmgr", "North Delhi, Pooja", "pooja", "ND");
  const C17 = await log("C17", "nitin", "Escalated to Prasant", "vinod");
  const C18 = await log("C18", "nitin", "Resolved by Rohit", "rohit");
  await resolve("rohit", C18);
  await log("C19", "readonly", "Readonly, home office 2", "readonly", "SE");
  await log("C20", "amit", "Readonly, held in office 1", "readonly");
  const C21 = await log("C21", "ndmgr", "North Delhi, resolved by Pooja", "pooja", "ND");
  await resolve("pooja", C21);

  // C06 / C17: escalated to prasant, who is not above the holder. The holder
  // reports to prasant for the moment of the escalation.
  try {
    must(await saveUser(c, "vivek", { ReportsTo: U.prasant }), "vivek reports to prasant");
    must(await saveUser(c, "vinod", { ReportsTo: U.prasant }), "vinod reports to prasant");
    await escalate("vivek", C06, "prasant");
    await escalate("vinod", C17, "prasant");
  } finally {
    must(await saveUser(c, "vivek", { ReportsTo: ids.people.vivek.ReportsTo }), "vivek back under his manager");
    must(await saveUser(c, "vinod", { ReportsTo: ids.people.vinod.ReportsTo }), "vinod back under his manager");
  }
  await resolve("vivek", C06);

  // C07: held and resolved by am_gone, who is active only for that.
  try {
    must(await saveUser(c, "gone", { UserActive: true }), "am_gone active for C07");
    await log("C07", "nitin", "Resolved by am_gone", "gone");
    await resolve("gone", data.complaints.C07.id);
  } finally {
    must(await saveUser(c, "gone", { UserActive: false }), "am_gone inactive again");
    c.forget("gone");
  }

  // C14: held by am_hr, who has the Support Agent role only while it is assigned.
  try {
    must(await saveUser(c, "hr", { GroupId: ids.people.nitin.GroupId }), "am_hr as Support Agent for C14");
    await log("C14", "amit", "Held by am_hr", "hr");
  } finally {
    must(await saveUser(c, "hr", { GroupId: ids.people.hr.GroupId }), "am_hr back to his role");
    c.forget("hr");
  }

  return hydrate(data);
}

// ---- one run per jest invocation ---------------------------------------------
// globalSetup.js creates it and writes the file named in LIVE_RUN_FILE; every
// suite reads that. Without the file (a suite run outside the config) the
// process makes its own, once.
let cached = null;
function writeRun(run) {
  const file = path.join(os.tmpdir(), `nexus-live-run-${run.runId}.json`);
  fs.writeFileSync(file, JSON.stringify(run));
  return file;
}
async function currentRun() {
  if (!cached) {
    const file = process.env.LIVE_RUN_FILE;
    cached = file && fs.existsSync(file)
      ? Promise.resolve(hydrate(JSON.parse(fs.readFileSync(file, "utf8"))))
      : createRun();
  }
  return cached;
}

/**
 * The suites' id map: client.js's people (users / people) with this run's
 * records on top, so `id.C01`, `id.L03`, `id.customers.HO`, `id.users.solo`
 * are this run's.
 */
function runIds(run, ids) {
  const out = { users: { ...ids.users, ...run.users }, people: ids.people, customers: {} };
  for (const [k, r] of Object.entries(run.complaints)) out[k] = r.id;
  for (const [k, r] of Object.entries(run.leads)) out[k] = r.id;
  for (const [k, r] of Object.entries(run.customers)) out.customers[k] = r.id;
  return out;
}

module.exports = { createRun, currentRun, writeRun, hydrate, runIds, stamp, EXTRA_PERSONAS };
