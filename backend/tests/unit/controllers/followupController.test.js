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

const baseReq = (overrides = {}) => ({
  user: { UserId: 7, CompId: 5, BranchId: 2 },
  scope: { dataScope: "Branch", branchIds: [2], ownerIds: null, isAdmin: false },
  body: {},
  ...overrides,
});
const visibleLead = { Id: 9, BranchId: 2, OwnerId: 7, CreatedBy: 7 };
const leadLookup = (lead) =>
  database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [lead ? [lead] : [], [], [], [], []] });
const fuLookup = (row) =>
  database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [row ? [row] : []] });
const status = (row) => database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[row]] });
// assertCanAssign's roster lookup (sp_FetchAssignableUsers).
const roster = (...ids) =>
  database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [ids.map((Id) => ({ Id }))] });
const spNames = () => database.executeStoredProcedure.mock.calls.map(([name]) => name);

beforeEach(() => database.executeStoredProcedure.mockReset());

describe("schedule", () => {
  it("gates on the lead and forwards the row", async () => {
    leadLookup(visibleLead);
    status({ Id: 21, ResponseCode: 201, ResponseMess: "Follow-up scheduled" });
    const res = mockRes();
    await followupController.schedule(baseReq({ body: { LeadId: 9, Type: "visit", DueAt: "2026-09-12" } }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_ScheduleFollowUp", {
      CompId: 5, LeadId: 9, UserId: 7, Type: "visit", DueAt: "2026-09-12", AssignedTo: null,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data.Id).toBe(21);
  });

  it("403s a lead outside scope", async () => {
    leadLookup({ Id: 9, BranchId: 9, OwnerId: 3, CreatedBy: 3 });
    const res = mockRes();
    await followupController.schedule(baseReq({ body: { LeadId: 9, DueAt: "2026-09-12" } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("400s without a due date, before any lookup", async () => {
    const res = mockRes();
    await followupController.schedule(baseReq({ body: { LeadId: 9 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  // Scheduling onto another user is an assignment. Without this gate a Branch
  // user could park work on anyone in the company by posting their Id.
  it("403s an AssignedTo outside the caller's roster and never reaches the SP", async () => {
    leadLookup(visibleLead);
    roster(7, 8); // 12 is not assignable to this caller
    const res = mockRes();
    await followupController.schedule(baseReq({ body: { LeadId: 9, DueAt: "2026-09-12", AssignedTo: 12 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(spNames()).toEqual(["sp_FetchLeadDetail", "sp_FetchAssignableUsers"]);
    expect(spNames()).not.toContain("sp_ScheduleFollowUp");
  });

  it("schedules onto a user the roster does list", async () => {
    leadLookup(visibleLead);
    roster(7, 8);
    status({ Id: 22, ResponseCode: 201, ResponseMess: "Follow-up scheduled" });
    const res = mockRes();
    await followupController.schedule(baseReq({ body: { LeadId: 9, DueAt: "2026-09-12", AssignedTo: 8 } }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_ScheduleFollowUp", {
      CompId: 5, LeadId: 9, UserId: 7, Type: "call", DueAt: "2026-09-12", AssignedTo: 8,
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  // A destructuring default only fires on `undefined`; the client sends an
  // explicit null when the Type picker is untouched.
  it("defaults an explicit null Type to 'call'", async () => {
    leadLookup(visibleLead);
    status({ Id: 23, ResponseCode: 201, ResponseMess: "Follow-up scheduled" });
    const res = mockRes();
    await followupController.schedule(baseReq({ body: { LeadId: 9, Type: null, DueAt: "2026-09-12" } }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_ScheduleFollowUp", {
      CompId: 5, LeadId: 9, UserId: 7, Type: "call", DueAt: "2026-09-12", AssignedTo: null,
    });
  });
});

describe("complete", () => {
  const row = { Id: 21, LeadId: 9, Status: "open", AssignedTo: 7, BranchId: 2, OwnerId: 7, CreatedBy: 7 };

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
    expect(database.executeStoredProcedure).toHaveBeenNthCalledWith(1, "sp_FetchFollowUpLead", { CompId: 5, Id: 21 });
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_CompleteFollowUp", {
      CompId: 5, Id: 21, UserId: 7, OutcomeId: 3, Remarks: "Spoke", Direction: "out", Duration: 5,
      NextType: "visit", NextDueAt: "2026-09-14",
    });
    expect(res.json.mock.calls[0][0].data).toEqual({ Id: 21, NextId: 22 });
  });

  // The follow-up is assigned to me though the lead is a colleague's: still mine to log.
  it("allows the assignee even when the lead is outside their owner scope", async () => {
    fuLookup({ ...row, OwnerId: 3, CreatedBy: 3, AssignedTo: 7 });
    status({ Id: 21, NextId: null, ResponseCode: 200, ResponseMess: "ok" });
    const res = mockRes();
    await followupController.complete(baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { Id: 21, Remarks: "ok" } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
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
    fuLookup({ Id: 21, LeadId: 9, Status: "open", AssignedTo: 7, BranchId: 2, OwnerId: 7, CreatedBy: 7 });
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

  it("queue mode passes scope + filters and maps pagination", async () => {
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
      UserId: 7, AccessibleBranchIdsJson: "[2]", OwnerIdsJson: "[7]", PageNumber: 1, PageSize: 25,
    }));
    expect(res.json.mock.calls[0][0].data.pagination).toEqual({ currentPage: 1, pageSize: 25, totalRecords: 1, totalPages: 1 });
  });

  it("403s the per-lead mode when the lead is out of scope, without fetching rows", async () => {
    leadLookup({ Id: 9, BranchId: 9, OwnerId: 3, CreatedBy: 3 });
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
});

describe("delete", () => {
  it("resolves the lead, gates, then deletes", async () => {
    fuLookup({ Id: 21, LeadId: 9, Status: "open", AssignedTo: 7, BranchId: 2, OwnerId: 7, CreatedBy: 7 });
    status({ ResponseCode: 200, ResponseMess: "Follow-up deleted successfully" });
    const res = mockRes();
    await followupController.delete(baseReq({ body: { Id: 21 } }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_DeleteFollowUp", { Id: 21, CompId: 5 });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("403s when the lead is out of scope", async () => {
    fuLookup({ Id: 21, LeadId: 9, Status: "open", AssignedTo: 3, BranchId: 9, OwnerId: 3, CreatedBy: 3 });
    const res = mockRes();
    await followupController.delete(baseReq({ body: { Id: 21 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  // Done rows are history: the SP refuses them and the controller must not
  // dress that 409 up as a success.
  it("passes the SP's 409 for a done follow-up through", async () => {
    fuLookup({ Id: 21, LeadId: 9, Status: "done", AssignedTo: 7, BranchId: 2, OwnerId: 7, CreatedBy: 7 });
    status({ ResponseCode: 409, ResponseMess: "Only an open follow-up can be deleted" });
    const res = mockRes();
    await followupController.delete(baseReq({ body: { Id: 21 } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });
});
