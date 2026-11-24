// tests/live/roles.live.js — every role, with a team and without, on both
// modules (owner requirement 2026-11-22). Read-only, plus refused writes.
//
// Per persona, on this run's records (fixtures.js; the list is narrowed to the
// run's tag so earlier runs never count):
//   list      exactly the records the access rules give them (or 403 without
//             the module)
//   open      each record: 200 when listed, else exactly a missing id's 404
//   assign    the "Can assign to" level, read from sentinel people: an office-1
//             worker, an office-6 worker (child of office 1), an office-2
//             worker, plus people who may never be listed
//   closed    may they reassign a closed record; reopen one (complaints)
//   send back the holder's button names the giver; anyone else is refused
// An allowed reassign / reopen / send back is asserted from the detail flags
// only (flows.live.js carries them out); a refused one is POSTed and must
// answer the exact sentence.
//
// Roles: Admin amit · Support Head vikram · Branch Manager neha (office 1),
// ndmgr (office 6) · Support Manager supmgr · Regional Manager regmgr
// (office tree 1 -> 6/7/8) · Sales Head saleshead · Support Team Lead rohit
// (team vinod, vivek, gone) · Sales Team Lead stl (team field) · Support Agent
// with a lead vinod, vivek / without nitin, prasant / other office pooja /
// read-only extra office readonly · Sales Executive under a team lead field,
// under a manager kasak, roshan, with nobody above solo · Central desk imran ·
// no module hr.

const { live, MISSING_ID, isRefusal, lookups } = require("./client");
const { currentRun, runIds } = require("./fixtures");

const c = live();
let id;
let lk;
let run;

beforeAll(async () => {
  run = await currentRun();
  id = runIds(run, await c.ids());
  lk = await lookups(c);
});

const post = (who, path, body) => c.as(who).post(path, body);
const NO_MODULE = { status: 403, message: "You do not have permission for this action", refused: true };
const outcome = (r) => ({ status: r.status, message: r.body?.message, refused: isRefusal(r) });
const keys = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`);
const ALL = { complaints: keys("C", 21), leads: keys("L", 10) };
const OFFICE1_C = ALL.complaints.filter((k) => !["C16", "C19", "C21"].includes(k));

const M = {
  complaints: {
    list: "/api/tickets/fetchTickets", rows: "tickets", label: "Subject", detail: "/api/tickets/fetchTicketDetail",
    idKey: "TicketId", record: "ticket", notFound: "Complaint not found", rec: (k) => run.complaint(k),
  },
  leads: {
    list: "/api/leads/fetchLeads", rows: "leads", label: "Name", detail: "/api/leads/fetchLeadDetail",
    idKey: "LeadId", record: "lead", notFound: "Lead not found", rec: (k) => run.lead(k),
  },
};

// null = no module. Lists follow fn_VisibleTickets / fn_VisibleLeads: reach
// (Own / Team / Office / OfficeTree / Company) OR held by me OR (complaints)
// escalated to me while open.
const SEES = {
  amit: { complaints: ALL.complaints, leads: ALL.leads },
  vikram: { complaints: ALL.complaints, leads: null },
  neha: { complaints: OFFICE1_C, leads: ALL.leads },
  ndmgr: { complaints: ["C16", "C21"], leads: [] },
  supmgr: { complaints: OFFICE1_C, leads: null },
  regmgr: { complaints: [...OFFICE1_C, "C16", "C21"], leads: ALL.leads },
  saleshead: { complaints: null, leads: ALL.leads },
  rohit: { complaints: ["C01", "C04", "C05", "C06", "C07", "C08", "C09", "C10", "C11", "C12", "C13", "C15", "C17", "C18"], leads: null },
  stl: { complaints: null, leads: ["L06", "L07", "L10"] },
  vinod: { complaints: ["C01", "C04", "C05", "C08", "C09", "C10", "C11", "C12", "C13", "C15", "C17"], leads: null },
  vivek: { complaints: ["C06"], leads: null },
  nitin: { complaints: ["C02"], leads: null },
  prasant: { complaints: ["C17"], leads: null },
  pooja: { complaints: ["C16", "C21"], leads: null },
  readonly: { complaints: ["C19", "C20"], leads: null },
  imran: { complaints: [], leads: null },
  field: { complaints: null, leads: ["L06", "L07", "L10"] },
  kasak: { complaints: null, leads: ["L01", "L02", "L04", "L08"] },
  roshan: { complaints: null, leads: ["L03", "L09"] },
  solo: { complaints: null, leads: [] },
  hr: { complaints: null, leads: null },
};

// "Can assign to", by sentinel: complaints vinod (office 1) / pooja (office 6,
// below office 1) / readonly (office 2); leads roshan (office 1) / ndmgr
// (office 6). Company = all; OfficeTree = 1 + 6; Office = own office (+ self,
// manager, people).
const ASSIGN = {
  complaints: {
    sentinels: ["vinod", "pooja", "readonly"],
    never: ["hr", "gone", "kasak"],
    expect: {
      amit: [1, 1, 1], vikram: [1, 1, 1], imran: [1, 1, 1],
      regmgr: [1, 1, 0],
      neha: [1, 0, 0], supmgr: [1, 0, 0], rohit: [1, 0, 0], vinod: [1, 0, 0], vivek: [1, 0, 0], nitin: [1, 0, 0], prasant: [1, 0, 0],
      ndmgr: [0, 1, 0], pooja: [0, 1, 0],
      readonly: [0, 0, 1],
    },
  },
  leads: {
    sentinels: ["roshan", "ndmgr"],
    never: ["nitin", "gone", "hr"],
    expect: {
      amit: [1, 1], saleshead: [1, 1], regmgr: [1, 1],
      neha: [1, 0], stl: [1, 0], field: [1, 0], kasak: [1, 0], roshan: [1, 0], solo: [1, 0],
      ndmgr: [0, 1],
    },
  },
};

describe.each(Object.keys(SEES))("%s", (who) => {
  describe.each(["complaints", "leads"])("%s", (mod) => {
    const m = M[mod];
    const sees = SEES[who][mod];

    it(sees ? "lists exactly what the rules give, and opens exactly that" : "has no module: list, picker refused at the route", async () => {
      const r = await post(who, m.list, { SearchTerm: run.tag, PageSize: 100 });
      if (!sees) {
        expect(outcome(r)).toEqual(NO_MODULE);
        expect(outcome(await post(who, "/api/users/fetchAssignableUsers", { Module: mod }))).toEqual(NO_MODULE);
        return;
      }
      expect(r.status).toBe(200);
      const byId = Object.fromEntries(ALL[mod].map((k) => [m.rec(k).id, k]));
      const listed = r.body.data[m.rows].map((x) => byId[x.Id] ?? `foreign ${x[m.label]}`).sort();
      expect({ who, listed }).toEqual({ who, listed: [...sees].sort() });
      expect(r.body.data.pagination.totalRecords).toBe(sees.length);

      const missing = outcome(await post(who, m.detail, { [m.idKey]: MISSING_ID }));
      expect(missing).toEqual({ status: 404, message: m.notFound, refused: true });
      const wrong = [];
      for (const k of ALL[mod]) {
        const got = outcome(await post(who, m.detail, { [m.idKey]: m.rec(k).id }));
        const ok = sees.includes(k) ? got.status === 200 : JSON.stringify(got) === JSON.stringify(missing);
        if (!ok) wrong.push(`${k}: ${got.status} ${got.message}`);
      }
      expect({ who, wrong }).toEqual({ who, wrong: [] });
    });

    const a = ASSIGN[mod];
    if (a.expect[who]) {
      it("assign list follows the Can assign to level", async () => {
        const r = await post(who, "/api/users/fetchAssignableUsers", { Module: mod });
        expect(r.status).toBe(200);
        const got = r.body.data.users.map((u) => u.Id);
        const listed = (p) => (got.includes(id.users[p]) ? 1 : 0);
        expect({ who, sentinels: a.sentinels.map(listed) }).toEqual({ who, sentinels: a.expect[who] });
        expect({ who, never: a.never.filter(listed) }).toEqual({ who, never: [] });
      });
    }
  });
});

// ---- closed records -----------------------------------------------------------
const reassign = (who, mod, recordId, toUser) => (mod === "complaints"
  ? post(who, "/api/tickets/transferTicket", { TicketId: recordId, ToUserId: id.users[toUser], ReasonId: lk.reasonId, Remarks: "AM live" })
  : post(who, "/api/leads/transferLead", { LeadId: recordId, ToUserId: id.users[toUser], ReasonId: lk.reasonId, Remarks: "AM live" }));
const detailOf = async (who, mod, k) => {
  const r = await post(who, M[mod].detail, { [M[mod].idKey]: M[mod].rec(k).id });
  expect({ who, k, status: r.status }).toEqual({ who, k, status: 200 });
  return r.body.data[M[mod].record];
};
const CLOSED_REFUSED = { status: 403, message: "Only a manager can reassign a closed record", refused: true };
const REOPEN_REFUSED = { status: 403, message: "Reopening requires a manager", refused: true };

describe("a closed complaint: reassign and reopen", () => {
  // [who, record, may reassign, may reopen]; reach Office or wider may both,
  // a team lead may reopen his people's but never his own, Own may neither.
  it.each([
    ["amit", "C05", true, true], ["vikram", "C05", true, true], ["neha", "C05", true, true],
    ["supmgr", "C05", true, true], ["regmgr", "C05", true, true], ["regmgr", "C21", true, true], ["ndmgr", "C21", true, true],
    ["rohit", "C05", false, true], ["rohit", "C18", false, false],
    ["vinod", "C05", false, false], ["vivek", "C06", false, false], ["pooja", "C21", false, false],
  ])("%s on %s: reassign %s, reopen %s", async (who, k, canReassign, canReopen) => {
    const t = await detailOf(who, "complaints", k);
    expect({ CanReassign: Boolean(t.CanReassign), CanReopen: Boolean(t.CanReopen) })
      .toEqual({ CanReassign: canReassign, CanReopen: canReopen });
    if (!canReassign) expect(outcome(await reassign(who, "complaints", t.Id, "prasant"))).toEqual(CLOSED_REFUSED);
    if (!canReopen) {
      expect(outcome(await post(who, "/api/tickets/reopenTicket", { TicketId: t.Id, Remarks: "AM live" }))).toEqual(REOPEN_REFUSED);
    }
  });

  it.each(["nitin", "prasant", "imran", "readonly"])("%s cannot see C05: reassign and reopen answer as for a missing id", async (who) => {
    const RECORD_404 = { status: 404, message: "Record not found", refused: true };
    const C_404 = { status: 404, message: "Complaint not found", refused: true };
    for (const TicketId of [id.C05, MISSING_ID]) {
      expect(outcome(await reassign(who, "complaints", TicketId, "vinod"))).toEqual(RECORD_404);
      expect(outcome(await post(who, "/api/tickets/reopenTicket", { TicketId, Remarks: "AM live" }))).toEqual(C_404);
    }
  });
});

describe("a closed lead: reassign", () => {
  it.each([
    ["amit", "L02", true], ["saleshead", "L02", true], ["neha", "L02", true], ["regmgr", "L08", true],
    ["kasak", "L02", false], ["kasak", "L08", false], ["stl", "L10", false], ["field", "L10", false],
  ])("%s on %s: reassign %s", async (who, k, canReassign) => {
    const l = await detailOf(who, "leads", k);
    expect(Boolean(l.CanReassign)).toBe(canReassign);
    if (!canReassign) expect(outcome(await reassign(who, "leads", l.Id, "roshan"))).toEqual(CLOSED_REFUSED);
  });

  it.each(["roshan", "solo", "ndmgr"])("%s cannot see L02: reassign answers as for a missing id", async (who) => {
    for (const LeadId of [id.L02, MISSING_ID]) {
      expect(outcome(await reassign(who, "leads", LeadId, "kasak"))).toEqual({ status: 404, message: "Lead not found", refused: true });
    }
  });
});

// ---- send back ----------------------------------------------------------------
const sendBack = (who, mod, recordId) => (mod === "complaints"
  ? post(who, "/api/tickets/transferTicket", { TicketId: recordId, SendBack: true, Remarks: "AM live" })
  : post(who, "/api/leads/transferLead", { LeadId: recordId, SendBack: true, Remarks: "AM live" }));
const NOBODY = { status: 400, message: "There is nobody to send this back to." };
const said = (r) => ({ status: r.status, message: r.body?.message });

describe("send back", () => {
  it.each([
    ["vinod", "complaints", "C01", "nitin"], ["pooja", "complaints", "C16", "ndmgr"], ["readonly", "complaints", "C20", "amit"],
    ["roshan", "leads", "L09", "kasak"],
  ])("%s holds %s %s: the button names %s", async (who, mod, k, giver) => {
    const rec = await detailOf(who, mod, k);
    expect({ id: rec.SendBackToId, name: rec.SendBackToName })
      .toEqual({ id: id.users[giver], name: id.people[giver].FullName });
  });

  it.each([
    ["amit", "complaints", "C01"], ["vikram", "complaints", "C01"], ["neha", "complaints", "C01"], ["supmgr", "complaints", "C01"],
    ["regmgr", "complaints", "C01"], ["rohit", "complaints", "C01"], ["prasant", "complaints", "C17"], ["ndmgr", "complaints", "C16"],
    ["nitin", "complaints", "C02"], ["readonly", "complaints", "C19"],
    ["amit", "leads", "L01"], ["saleshead", "leads", "L01"], ["neha", "leads", "L01"], ["regmgr", "leads", "L01"],
    ["stl", "leads", "L06"], ["kasak", "leads", "L01"], ["field", "leads", "L06"],
  ])("%s on %s %s (not given to them by anyone): no button, refused", async (who, mod, k) => {
    const rec = await detailOf(who, mod, k);
    expect(rec.SendBackToId ?? null).toBeNull();
    const r = await sendBack(who, mod, rec.Id);
    expect({ ...said(r), success: r.body?.success }).toEqual({ ...NOBODY, success: false });
  });

  it("vivek on his resolved C06: the closed-record gate answers first", async () => {
    expect(outcome(await sendBack("vivek", "complaints", id.C06))).toEqual(CLOSED_REFUSED);
  });

  it.each([
    ["imran", "complaints", "C01", "Record not found"], ["solo", "leads", "L01", "Lead not found"], ["ndmgr", "leads", "L01", "Lead not found"],
  ])("%s cannot see %s %s: as for a missing id", async (who, mod, k, message) => {
    for (const recordId of [M[mod].rec(k).id, MISSING_ID]) {
      expect(outcome(await sendBack(who, mod, recordId))).toEqual({ status: 404, message, refused: true });
    }
  });
});
