// tests/live/legacy.live.js — the bodies an installed phone build sends
// (Review Focus 1, D23). They must keep working with the old fields present.
//
// One write (a reassign without SendBack), undone in the same test, so the
// seed is left as it was. Run with matrix.live.js, before flows.live.js.

const { live, lookups } = require("./client");

const c = live();
let id;
let lk;

beforeAll(async () => {
  id = await c.ids();
  lk = await lookups(c);
});

const post = (who, path, body) => c.as(who).post(path, body);
const OLD_USER_FIELDS = ["Id", "FullName", "Avatar", "JobTitle", "BranchId", "BranchName", "ReportsTo"];

describe("an installed phone build", () => {
  it("fetchAssignableUsers { BranchId: null, Module: 'leads' } lists, with the old fields", async () => {
    const r = await post("kasak", "/api/users/fetchAssignableUsers", { BranchId: null, Module: "leads" });
    expect(r.status).toBe(200);
    expect(r.body.data.users.length).toBeGreaterThan(0);
    for (const f of OLD_USER_FIELDS) expect(r.body.data.users[0]).toHaveProperty(f);
  });

  it("fetchAssignableUsers { BranchId: 6 } (no Module) gives the same list as the new body", async () => {
    const old = await post("nitin", "/api/users/fetchAssignableUsers", { BranchId: 6 });
    const now = await post("nitin", "/api/users/fetchAssignableUsers", { Module: "complaints" });
    expect(old.status).toBe(200);
    expect(old.body.data.users.length).toBeGreaterThan(0);
    expect(old.body.data.users.map((u) => u.Id)).toEqual(now.body.data.users.map((u) => u.Id));
  });

  it("transferTicket without SendBack reassigns, and back again", async () => {
    const there = await post("vinod", "/api/tickets/transferTicket", {
      TicketId: id.C12, ToUserId: id.users.vivek, ReasonId: lk.reasonId, Remarks: "AM live: legacy reassign",
    });
    expect(there.status).toBe(200);
    for (const f of ["Id", "ResponseCode", "ResponseMess"]) expect(there.body.data).toHaveProperty(f);
    const back = await post("vivek", "/api/tickets/transferTicket", {
      TicketId: id.C12, ToUserId: id.users.vinod, ReasonId: lk.reasonId, Remarks: "AM live: legacy restore",
    });
    expect(back.status).toBe(200);
  });

  it("fetchEscalationTargets { ForUserId } for a holder of open complaints answers his chain", async () => {
    const r = await post("vinod", "/api/tickets/fetchEscalationTargets", { ForUserId: id.users.vinod });
    expect(r.status).toBe(200);
    const users = r.body.data.users;
    expect(users.map((u) => u.Id)).toContain(id.users.rohit);
    for (const f of ["Id", "FullName", "JobTitle", "BranchId", "BranchName", "Depth"]) expect(users[0]).toHaveProperty(f);
  });

  it("fetchEscalationTargets with an empty body (the old default: myself) answers the same chain", async () => {
    const empty = await post("vinod", "/api/tickets/fetchEscalationTargets", {});
    const mine = await post("vinod", "/api/tickets/fetchEscalationTargets", { ForUserId: id.users.vinod });
    expect(empty.status).toBe(200);
    expect(empty.body.data.users.map((u) => u.Id)).toEqual(mine.body.data.users.map((u) => u.Id));
  });
});
