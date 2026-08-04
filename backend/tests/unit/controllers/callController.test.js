jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const callController = require("../../../src/controllers/callController");
const { mockRes } = require("../../helpers/mockRes");

function baseReq(overrides = {}) {
  return {
    user: { UserId: 7, CompId: 5, BranchId: 2, IsAdmin: false },
    scope: { branchIds: [2], ownerIds: null, isAdmin: false },
    body: {},
    ...overrides,
  };
}

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
});

// Guard lookup: logCall now verifies the caller can see the lead/ticket the
// call is logged against (sp_FetchLeadDetail / sp_FetchTicketDetail).
function mockLeadLookup(lead) {
  database.executeStoredProcedure.mockResolvedValueOnce({
    recordsets: [lead ? [lead] : [], [], []],
  });
}
function mockTicketLookup(ticket) {
  database.executeStoredProcedure.mockResolvedValueOnce({
    recordsets: [ticket ? [ticket] : [], [], [], []],
  });
}

describe("callController.logCall", () => {
  it("logs a ticket call (TicketId set, LeadId null)", async () => {
    mockTicketLookup({ Id: 4, BranchId: 2, AssignedTo: 3, CreatedBy: 3 });
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Logged", Id: 60 }],
    });
    const req = baseReq({ body: { TicketId: 4, Direction: "out" } });
    const res = mockRes();
    await callController.logCall(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_LogCall",
      expect.objectContaining({ CompId: 5, UserId: 7, LeadId: null, TicketId: 4, Direction: "out" }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("injects CompId/UserId and forwards a lead call with NextFollowupDate", async () => {
    mockLeadLookup({ Id: 9, BranchId: 2, OwnerId: 3, CreatedBy: 3 });
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Logged", Id: 55 }],
    });
    const req = baseReq({
      body: {
        LeadId: 9,
        Direction: "Outbound",
        OutcomeId: 3,
        Notes: "Interested",
        Duration: 120,
        NextFollowupDate: "2026-07-10",
        FollowupRemarks: "Call back next week",
      },
    });
    const res = mockRes();
    await callController.logCall(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_LogCall",
      expect.objectContaining({
        CompId: 5,
        UserId: 7,
        LeadId: 9,
        TicketId: null,
        Direction: "Outbound",
        OutcomeId: 3,
        Notes: "Interested",
        Duration: 120,
        NextFollowupDate: "2026-07-10",
        FollowupRemarks: "Call back next week",
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].success).toBe(true);
    expect(res.json.mock.calls[0][0].data.Id).toBe(55);
  });

  it("defaults optional fields to null when absent from body", async () => {
    mockLeadLookup({ Id: 9, BranchId: 2, OwnerId: 3, CreatedBy: 3 });
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Logged", Id: 56 }],
    });
    const req = baseReq({ body: { LeadId: 9, Direction: "Inbound" } });
    const res = mockRes();
    await callController.logCall(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_LogCall",
      expect.objectContaining({
        TicketId: null,
        OutcomeId: null,
        Notes: null,
        Duration: null,
        NextFollowupDate: null,
        FollowupRemarks: null,
      }),
    );
  });

  it("400s when neither LeadId nor TicketId is provided, without touching the DB", async () => {
    const req = baseReq({ body: { Direction: "Outbound" } });
    const res = mockRes();
    await callController.logCall(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].success).toBe(false);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("returns error status when SP rejects", async () => {
    mockLeadLookup({ Id: 9, BranchId: 2, OwnerId: 7, CreatedBy: 7 });
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 400, ResponseMess: "Direction required" }],
    });
    const req = baseReq({ body: { LeadId: 9 } });
    const res = mockRes();
    await callController.logCall(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  // REGRESSION: logCall used to trust the client-supplied LeadId/TicketId — a
  // Self-scoped user could pollute any record's timeline (and reschedule its
  // follow-up) by posting a foreign Id.
  it("403s logging a call against a lead the caller cannot see", async () => {
    mockLeadLookup({ Id: 9, BranchId: 9, OwnerId: 3, CreatedBy: 3 });
    const req = baseReq({
      scope: { branchIds: [2], ownerIds: [7] },
      body: { LeadId: 9, Direction: "Outbound" },
    });
    const res = mockRes();
    await callController.logCall(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1); // lookup only
  });

  it("403s logging a call against a ticket outside the caller's scope", async () => {
    mockTicketLookup({ Id: 4, BranchId: 9, AssignedTo: 3, CreatedBy: 3 });
    const req = baseReq({
      scope: { branchIds: [2], ownerIds: [7] },
      body: { TicketId: 4, Direction: "in" },
    });
    const res = mockRes();
    await callController.logCall(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({ body: { LeadId: 9, Direction: "Outbound" } });
    const res = mockRes();
    await callController.logCall(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("callController.fetchCalls", () => {
  it("fetches by lead when LeadId is provided in body", async () => {
    mockLeadLookup({ Id: 9, BranchId: 2, OwnerId: 7, CreatedBy: 7 });
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, LeadId: 9, Direction: "Outbound" }],
    });
    const req = baseReq({ body: { LeadId: 9 } });
    const res = mockRes();
    await callController.fetchCalls(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchCalls",
      expect.objectContaining({ CompId: 5, LeadId: 9, TicketId: null, UserId: 7 }),
    );
    const json = res.json.mock.calls[0][0];
    expect(json.data.calls).toEqual([{ Id: 1, LeadId: 9, Direction: "Outbound" }]);
  });

  // The whole point of 067: a ticket's calls were unreachable, because
  // sp_FetchCalls had no TicketId parameter and the controller never sent one.
  it("fetches by ticket when TicketId is provided in body", async () => {
    mockTicketLookup({ Id: 4, BranchId: 2, AssignedTo: 7, CreatedBy: 7 });
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 2, TicketId: 4, Direction: "in" }],
    });
    const req = baseReq({ body: { TicketId: 4 } });
    const res = mockRes();
    await callController.fetchCalls(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchCalls",
      expect.objectContaining({ CompId: 5, LeadId: null, TicketId: 4, UserId: 7 }),
    );
    const json = res.json.mock.calls[0][0];
    expect(json.data.calls).toEqual([{ Id: 2, TicketId: 4, Direction: "in" }]);
  });

  it("prefers the lead filter when both ids are sent", async () => {
    mockLeadLookup({ Id: 9, BranchId: 2, OwnerId: 7, CreatedBy: 7 });
    database.executeStoredProcedure.mockResolvedValueOnce({ recordset: [] });
    const req = baseReq({ body: { LeadId: 9, TicketId: 4 } });
    const res = mockRes();
    await callController.fetchCalls(req, res);

    // Only the lead is access-checked; the ticket check is skipped entirely.
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith(
      "sp_FetchCalls",
      expect.objectContaining({ LeadId: 9, TicketId: 4 }),
    );
  });

  it("fetches by user when neither id is in the body", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordset: [] });
    const req = baseReq();
    const res = mockRes();
    await callController.fetchCalls(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchCalls",
      expect.objectContaining({ CompId: 5, LeadId: null, TicketId: null, UserId: 7 }),
    );
    const json = res.json.mock.calls[0][0];
    expect(json.data.calls).toEqual([]);
  });

  // Call notes are free text about a customer — reading them must be gated the
  // same way logCall gates writing one.
  it("refuses a lead the caller cannot see, without querying calls", async () => {
    mockLeadLookup(null);
    const req = baseReq({ body: { LeadId: 9 } });
    const res = mockRes();
    await callController.fetchCalls(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("refuses a ticket the caller cannot see, without querying calls", async () => {
    mockTicketLookup(null);
    const req = baseReq({ body: { TicketId: 4 } });
    const res = mockRes();
    await callController.fetchCalls(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq();
    const res = mockRes();
    await callController.fetchCalls(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
