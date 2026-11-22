// The follow-up controller after 071: tblFollowUp is an activity, not a note.
// sp_SaveFollowUp / sp_FetchFollowUp are dropped, so every test here is new —
// schedule / complete / skip / fetch / delete, and the one rule that is not
// simply "can you see the lead": the assignee may always act on their own row.

jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const followupController = require("../../../src/controllers/followupController");
const { mockRes } = require("../../helpers/mockRes");
const { accessForScope } = require("../../helpers/mockAccess");

const rawReq = (overrides = {}) => ({
  user: { UserId: 7, CompId: 5, BranchId: 2 },
  scope: { reach: "Office", branchIds: [2], ownerIds: null, isAdmin: false },
  body: {},
  ...overrides,
});

// Routes run loadScope, which sets req.access too; assertRecordAccess judges a
// record against the module scope it derives from req.access, so the access
// mirrors whatever scope shape a test describes.
const baseReq = (overrides = {}) => {
  const req = rawReq(overrides);
  if (!req.access) req.access = accessForScope(req.scope, req.user.UserId);
  return req;
};
const visibleLead = { Id: 9, BranchId: 2, OwnerId: 7, CreatedBy: 7 };
const leadLookup = (lead) =>
  database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [lead ? [lead] : [], [], [], [], []] });
const fuLookup = (row) =>
  database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [row ? [row] : []] });
const status = (row) => database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[row]] });
// sp_FetchFollowUpLead rows as 132 answers them: Via 1 = lead visible, 2 = open and
// mine, 3 = a manager's look-only line (CanAct 0). No row = not visible.
const via1 = { Id: 21, LeadId: 9, Status: "open", AssignedTo: 7, BranchId: 2, OwnerId: 7, CreatedBy: 7, Via: 1, CanAct: true };
const via2 = { Id: 21, LeadId: 9, Status: "open", AssignedTo: 7, BranchId: null, OwnerId: null, CreatedBy: null, Via: 2, CanAct: true };
const via3 = { Id: 21, LeadId: 9, Status: "open", AssignedTo: 8, BranchId: null, OwnerId: null, CreatedBy: null, Via: 3, CanAct: false };
const spNames = () => database.executeStoredProcedure.mock.calls.map(([name]) => name);

beforeEach(() => database.executeStoredProcedure.mockReset());

describe("schedule", () => {
  // REGRESSION (B3, fix wave 2): DueAt went to the SP unvalidated — "+05:30" was a 500 and a "Z"
  // instant was stored 5h30m early as IST wall clock.
  it.each([
    ["date", "2026-10-12", "2026-10-12"],
    ["IST wall clock", "2026-10-12T12:00", "2026-10-12T12:00:00"],
    ["IST wall clock with seconds", "2026-10-12T12:00:30", "2026-10-12T12:00:30"],
    ["Z instant → IST wall clock", "2026-10-12T06:30:00.000Z", "2026-10-12 12:00:00"],
    ["offset instant → IST wall clock", "2026-10-12T12:00:00+05:30", "2026-10-12 12:00:00"],
    ["other offset", "2026-10-11T23:00:00-02:00", "2026-10-12 06:30:00"],
  ])("normalises DueAt: %s", async (_l, DueAt, want) => {
    status({ Id: 21, ResponseCode: 201, ResponseMess: "ok" });
    const res = mockRes();
    await followupController.schedule(baseReq({ body: { LeadId: 9, DueAt } }), res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(database.executeStoredProcedure.mock.calls.at(-1)[1].DueAt).toBe(want);
  });

  it.each(["12/10/2026", "2026-02-30", "2026-13-01", "2026-10-12T25:00", "tomorrow", 20261012, "2026-10-12T12:00+5"])(
    "400s an invalid DueAt %p before any DB call", async (DueAt) => {
      const res = mockRes();
      await followupController.schedule(baseReq({ body: { LeadId: 9, DueAt } }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].message).toBe("Follow-up date is not valid");
      expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    },
  );

  it("complete: NextDueAt is normalised the same way; an invalid one is a 400, null passes", async () => {
    let res = mockRes();
    await followupController.complete(baseReq({ body: { Id: 21, Remarks: "x", NextType: "call", NextDueAt: "2026-10-12T12:00:00+05:30x" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    fuLookup(via1);
    status({ Id: 21, ResponseCode: 200, ResponseMess: "ok" });
    res = mockRes();
    await followupController.complete(baseReq({ body: { Id: 21, Remarks: "x", NextType: "call", NextDueAt: "2026-10-12T06:30:00Z" } }), res);
    expect(database.executeStoredProcedure.mock.calls.at(-1)[1].NextDueAt).toBe("2026-10-12 12:00:00");
  });

  it("hands the lead and person to the procedure, which gates them, and forwards the row", async () => {
    status({ Id: 21, ResponseCode: 201, ResponseMess: "Follow-up scheduled" });
    const res = mockRes();
    await followupController.schedule(baseReq({ body: { LeadId: 9, Type: "visit", DueAt: "2026-09-12", UserId: 99, CompId: 98 } }), res);
    expect(spNames()).toEqual(["sp_ScheduleFollowUp"]);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_ScheduleFollowUp", {
      CompId: 5, LeadId: 9, UserId: 7, Type: "visit", DueAt: "2026-09-12", AssignedTo: null,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data.Id).toBe(21);
  });

  it("relays the procedure's 404 for a lead the caller cannot see", async () => {
    status({ Id: 0, ResponseCode: 404, ResponseMess: "Lead not found" });
    const res = mockRes();
    await followupController.schedule(baseReq({ body: { LeadId: 9, DueAt: "2026-09-12" } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].message).toBe("Lead not found");
  });

  it("400s without a due date, before any lookup", async () => {
    const res = mockRes();
    await followupController.schedule(baseReq({ body: { LeadId: 9 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("400s without a lead, before any lookup", async () => {
    const res = mockRes();
    await followupController.schedule(baseReq({ body: { DueAt: "2026-09-12" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  // Scheduling onto another person is an assignment; since 133 the procedure judges
  // it (Can assign to) and Node relays the refusal — no roster lookup in Node.
  it("schedule onto a person relays the procedure's 403", async () => {
    status({ Id: 0, ResponseCode: 403, ResponseMess: "You cannot assign records to that person" });
    const res = mockRes();
    await followupController.schedule(baseReq({ body: { LeadId: 9, DueAt: "2026-09-12", AssignedTo: 12 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].message).toBe("You cannot assign records to that person");
    expect(spNames()).toEqual(["sp_ScheduleFollowUp"]);
    expect(database.executeStoredProcedure.mock.calls[0][1].AssignedTo).toBe(12);
  });

  // A destructuring default only fires on `undefined`; the client sends an
  // explicit null when the Type picker is untouched.
  it("defaults an explicit null Type to 'call'", async () => {
    status({ Id: 23, ResponseCode: 201, ResponseMess: "Follow-up scheduled" });
    const res = mockRes();
    await followupController.schedule(baseReq({ body: { LeadId: 9, Type: null, DueAt: "2026-09-12" } }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_ScheduleFollowUp", {
      CompId: 5, LeadId: 9, UserId: 7, Type: "call", DueAt: "2026-09-12", AssignedTo: null,
    });
  });
});

describe("complete", () => {
  const row = via1;

  it("400s without remarks before any lookup", async () => {
    const res = mockRes();
    await followupController.complete(baseReq({ body: { Id: 21, Remarks: " " } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("looks the follow-up up, checks its lead, then completes with the next date", async () => {
    fuLookup(row);
    status({ Id: 21, NextId: 22, ResponseCode: 200, ResponseMess: "Follow-up logged" });
    const res = mockRes();
    await followupController.complete(
      baseReq({ body: { Id: 21, OutcomeId: 3, Remarks: "Spoke", Direction: "out", Duration: 5, NextType: "visit", NextDueAt: "2026-09-14" } }),
      res,
    );
    expect(database.executeStoredProcedure).toHaveBeenNthCalledWith(1, "sp_FetchFollowUpLead", { CompId: 5, UserId: 7, Id: 21 });
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_CompleteFollowUp", {
      CompId: 5, Id: 21, UserId: 7, OutcomeId: 3, Remarks: "Spoke", Direction: "out", Duration: 5,
      NextType: "visit", NextDueAt: "2026-09-14",
    });
    expect(res.json.mock.calls[0][0].data).toEqual({ Id: 21, NextId: 22 });
  });

  // The follow-up is assigned to me though the lead is a colleague's (Via 2): still mine to log.
  it("allows the assignee of an open follow-up whose lead they cannot see (Via 2)", async () => {
    fuLookup(via2);
    status({ Id: 21, NextId: null, ResponseCode: 200, ResponseMess: "ok" });
    const res = mockRes();
    await followupController.complete(baseReq({ body: { Id: 21, Remarks: "ok" } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // The database's word decides, not the Node lists: a row outside req.scope is still actionable.
  it("acts on a Via-1 row even when req.scope would have hidden it", async () => {
    fuLookup({ ...via1, BranchId: 9, OwnerId: 3, AssignedTo: 3 });
    status({ Id: 21, NextId: null, ResponseCode: 200, ResponseMess: "ok" });
    const res = mockRes();
    await followupController.complete(baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { Id: 21, Remarks: "ok" } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("403s a manager's look-only line (Via 3) without completing it", async () => {
    fuLookup(via3);
    const res = mockRes();
    await followupController.complete(baseReq({ body: { Id: 21, Remarks: "ok" } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].message).toBe("You can view this follow-up but not act on it");
    expect(spNames()).toEqual(["sp_FetchFollowUpLead"]);
  });

  it("404s an unknown follow-up", async () => {
    fuLookup(null);
    const res = mockRes();
    await followupController.complete(baseReq({ body: { Id: 21, Remarks: "ok" } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("passes the SP's 409 (already done) through", async () => {
    fuLookup(row);
    status({ Id: 21, NextId: null, ResponseCode: 409, ResponseMess: "Follow-up is already done" });
    const res = mockRes();
    await followupController.complete(baseReq({ body: { Id: 21, Remarks: "ok" } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("500s when the lookup throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await followupController.complete(baseReq({ body: { Id: 21, Remarks: "ok" } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("skip", () => {
  it("requires remarks and forwards", async () => {
    fuLookup(via1);
    status({ Id: 21, ResponseCode: 200, ResponseMess: "Follow-up skipped" });
    await followupController.skip(baseReq({ body: { Id: 21, Remarks: "Customer travelling" } }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_SkipFollowUp", {
      CompId: 5, Id: 21, UserId: 7, Remarks: "Customer travelling",
    });
  });

  it("400s a missing follow-up Id rather than letting the SP guess", async () => {
    const res = mockRes();
    await followupController.skip(baseReq({ body: { Remarks: "Customer travelling" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("403s a Via-3 follow-up", async () => {
    fuLookup(via3);
    const res = mockRes();
    await followupController.skip(baseReq({ body: { Id: 21, Remarks: "x" } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(spNames()).toEqual(["sp_FetchFollowUpLead"]);
  });

  it("404s a follow-up the database does not return", async () => {
    fuLookup(null);
    const res = mockRes();
    await followupController.skip(baseReq({ body: { Id: 21, Remarks: "x" } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(spNames()).toEqual(["sp_FetchFollowUpLead"]);
  });

  it("400s without remarks", async () => {
    const res = mockRes();
    await followupController.skip(baseReq({ body: { Id: 21 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
});

describe("fetch", () => {
  it("per-lead mode gates on the lead and returns rows without paging", async () => {
    leadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 21 }, { Id: 22 }]] });
    const res = mockRes();
    await followupController.fetch(baseReq({ body: { LeadId: 9 } }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith(
      "sp_FetchFollowUps",
      expect.objectContaining({ CompId: 5, LeadId: 9 }),
    );
    expect(res.json.mock.calls[0][0].data).toEqual({ followups: [{ Id: 21 }, { Id: 22 }] });
  });

  it("queue mode passes the person + filters, no list keys, and maps pagination", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 21 }], [{ TotalRecords: 1, TotalPages: 1, CurrentPage: 1, PageSize: 25 }]],
    });
    const res = mockRes();
    await followupController.fetch(
      baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { Overdue: true, AssignedTo: 7, DueTo: "2026-09-30" } }),
      res,
    );
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchFollowUps", expect.objectContaining({
      CompId: 5, LeadId: 0, Overdue: true, AssignedTo: 7, DueTo: "2026-09-30",
      UserId: 7, PageNumber: 1, PageSize: 25,
    }));
    expect(res.json.mock.calls[0][0].data.pagination).toEqual({ currentPage: 1, pageSize: 25, totalRecords: 1, totalPages: 1 });
  });

  it("fetch sends no list keys and takes the person from the session only", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await followupController.fetch(baseReq({ body: { UserId: 99, CompId: 98 } }), mockRes());
    const params = database.executeStoredProcedure.mock.calls[0][1];
    expect(Object.keys(params).filter((k) => /Json$/.test(k))).toEqual([]);
    expect(params).toMatchObject({ CompId: 5, UserId: 7 });
  });

  // Rows go out as the procedure shaped them: a Via-3 row already has LeadMobile NULL.
  it("returns rows exactly as the procedure gives them (Via 3 keeps its NULL phone)", async () => {
    const row = { Id: 21, Via: 3, LeadMobile: null, LeadName: "A" };
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[row], [{ TotalRecords: 1 }]] });
    const res = mockRes();
    await followupController.fetch(baseReq({ body: {} }), res);
    expect(res.json.mock.calls[0][0].data.followups).toEqual([row]);
  });

  it("403s the per-lead mode when the database does not return the lead, without fetching rows", async () => {
    leadLookup(null);
    const res = mockRes();
    await followupController.fetch(baseReq({ body: { LeadId: 9 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  it("falls back to the requested page when the SP returns no pagination row", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 21 }]] });
    const res = mockRes();
    await followupController.fetch(baseReq({ body: { Overdue: "true", PageNumber: 2, PageSize: 5 } }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchFollowUps",
      expect.objectContaining({ Overdue: true, PageNumber: 2, PageSize: 5 }),
    );
    expect(res.json.mock.calls[0][0].data.pagination).toEqual({
      currentPage: 2, pageSize: 5, totalRecords: 1, totalPages: 1,
    });
  });

  // 118: "Done today" on the mobile Home — DoneAt bracket, from inclusive, to exclusive.
  it("passes DoneFrom / DoneTo through as IST wall clock", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], [{ TotalRecords: 3 }]] });
    const res = mockRes();
    await followupController.fetch(
      baseReq({ body: { Status: "done", DoneFrom: "2026-11-02", DoneTo: "2026-11-02T18:30:00Z", PageSize: 1 } }),
      res,
    );
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchFollowUps",
      expect.objectContaining({ Status: "done", DoneFrom: "2026-11-02", DoneTo: "2026-11-03 00:00:00" }),
    );
    expect(res.json.mock.calls[0][0].data.pagination.totalRecords).toBe(3);
  });

  // Left out, not null: a DB without 118 would reject the unknown parameter.
  it("omits DoneFrom / DoneTo when absent, so a DB without 118 still answers", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await followupController.fetch(baseReq({ body: { DoneFrom: "" } }), mockRes());
    const params = database.executeStoredProcedure.mock.calls[0][1];
    expect(params).not.toHaveProperty("DoneFrom");
    expect(params).not.toHaveProperty("DoneTo");
  });

  it("sends only the bound that is set", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await followupController.fetch(baseReq({ body: { DoneTo: "2026-11-03" } }), mockRes());
    const params = database.executeStoredProcedure.mock.calls[0][1];
    expect(params.DoneTo).toBe("2026-11-03");
    expect(params).not.toHaveProperty("DoneFrom");
  });

  it.each([["DoneFrom", "yesterday"], ["DoneTo", "2026-02-30"], ["DoneFrom", 20261102]])(
    "400s a bad %s (%p) before any DB call",
    async (key, value) => {
      const res = mockRes();
      await followupController.fetch(baseReq({ body: { [key]: value } }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    },
  );
});

describe("delete", () => {
  it("resolves the lead, gates, then deletes", async () => {
    fuLookup(via1);
    status({ ResponseCode: 200, ResponseMess: "Follow-up deleted successfully" });
    const res = mockRes();
    await followupController.delete(baseReq({ body: { Id: 21 } }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_DeleteFollowUp", { Id: 21, CompId: 5 });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("403s a Via-3 follow-up", async () => {
    fuLookup(via3);
    const res = mockRes();
    await followupController.delete(baseReq({ body: { Id: 21 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(spNames()).toEqual(["sp_FetchFollowUpLead"]);
  });

  it("404s a follow-up the database does not return", async () => {
    fuLookup(null);
    const res = mockRes();
    await followupController.delete(baseReq({ body: { Id: 21 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(spNames()).toEqual(["sp_FetchFollowUpLead"]);
  });

  // REGRESSION (F1, 2026-11-21): a lead's past holder kept acting on its done
  // follow-ups after a transfer (which re-points only open ones). The database
  // no longer returns that row (Via 2 is open-only), so it is a 404.
  it("F1 regression: a done follow-up assigned to me whose lead left is not actionable (404)", async () => {
    fuLookup(null);
    const res = mockRes();
    await followupController.delete(baseReq({ body: { Id: 21 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(spNames()).toEqual(["sp_FetchFollowUpLead"]);
  });

  // Belt for the same rule: "mine" (Via 2) is only ever an OPEN follow-up.
  it("403s a Via-2 row that is not open, whatever CanAct says", async () => {
    fuLookup({ ...via2, Status: "done" });
    const res = mockRes();
    await followupController.delete(baseReq({ body: { Id: 21 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(spNames()).toEqual(["sp_FetchFollowUpLead"]);
  });

  it("lets the lead's holder act on a done follow-up assigned to someone else (Via 1)", async () => {
    fuLookup({ ...via1, Status: "done", AssignedTo: 3 });
    status({ ResponseCode: 409, ResponseMess: "Only an open follow-up can be deleted" });
    await followupController.delete(baseReq({ body: { Id: 21 } }), mockRes());
    expect(spNames()).toEqual(["sp_FetchFollowUpLead", "sp_DeleteFollowUp"]); // past the gate; the SP rules on state
  });

  // Done rows are history: the SP refuses them and the controller must not
  // dress that 409 up as a success.
  it("passes the SP's 409 for a done follow-up through", async () => {
    fuLookup({ ...via1, Status: "done" });
    status({ ResponseCode: 409, ResponseMess: "Only an open follow-up can be deleted" });
    const res = mockRes();
    await followupController.delete(baseReq({ body: { Id: 21 } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });
});
