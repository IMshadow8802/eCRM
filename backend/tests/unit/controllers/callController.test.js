jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const callController = require("../../../src/controllers/callController");
const { mockRes } = require("../../helpers/mockRes");

function baseReq(overrides = {}) {
  return {
    user: { UserId: 7, CompId: 5, BranchId: 2, IsAdmin: false },
    body: {},
    ...overrides,
  };
}

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
});

describe("callController.logCall", () => {
  it("injects CompId/UserId, forces TicketId null, and forwards NextFollowupDate", async () => {
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

  it("returns error status when SP rejects", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 400, ResponseMess: "LeadId required" }],
    });
    const req = baseReq({ body: { Direction: "Outbound" } });
    const res = mockRes();
    await callController.logCall(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].success).toBe(false);
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
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 1, LeadId: 9, Direction: "Outbound" }],
    });
    const req = baseReq({ body: { LeadId: 9 } });
    const res = mockRes();
    await callController.fetchCalls(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchCalls",
      expect.objectContaining({ CompId: 5, LeadId: 9, UserId: 7 }),
    );
    const json = res.json.mock.calls[0][0];
    expect(json.data.calls).toEqual([{ Id: 1, LeadId: 9, Direction: "Outbound" }]);
  });

  it("fetches by user when LeadId is absent from body", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordset: [] });
    const req = baseReq();
    const res = mockRes();
    await callController.fetchCalls(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchCalls",
      expect.objectContaining({ CompId: 5, LeadId: null, UserId: 7 }),
    );
    const json = res.json.mock.calls[0][0];
    expect(json.data.calls).toEqual([]);
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq();
    const res = mockRes();
    await callController.fetchCalls(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
