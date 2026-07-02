jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const followupController = require("../../../src/controllers/followupController");
const { mockRes } = require("../../helpers/mockRes");

function baseReq(overrides = {}) {
  return {
    user: { UserId: 7, CompId: 5, BranchId: 2, IsAdmin: false },
    body: {},
    scope: { branchIds: [] },
    ip: "127.0.0.1",
    headers: {},
    ...overrides,
  };
}

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
});

describe("followupController.save", () => {
  it("passes SourceCallId through to sp_SaveFollowUp when provided", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "Saved", FollowUpId: 12 }]],
    });
    const req = baseReq({
      body: {
        Id: 0,
        LeadId: 9,
        NextFollowupDate: "2026-07-10",
        SourceCallId: 55,
      },
    });
    const res = mockRes();
    await followupController.save(req, res);

    expect(database.executeStoredProcedure).toHaveBeenNthCalledWith(
      1,
      "sp_SaveFollowUp",
      expect.objectContaining({
        LeadId: 9,
        NextFollowupDate: "2026-07-10",
        SourceCallId: 55,
        CompId: 5,
        BranchId: 2,
        CreatedBy: 7,
        EditBy: 7,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].success).toBe(true);
    expect(res.json.mock.calls[0][0].data.followUpId).toBe(12);
  });

  it("defaults SourceCallId to null when absent from body", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "Saved", FollowUpId: 13 }]],
    });
    const req = baseReq({ body: { Id: 0, LeadId: 9 } });
    const res = mockRes();
    await followupController.save(req, res);

    expect(database.executeStoredProcedure).toHaveBeenNthCalledWith(
      1,
      "sp_SaveFollowUp",
      expect.objectContaining({ SourceCallId: null }),
    );
  });

  it("accepts legacy LeadID field name", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "Saved", FollowUpId: 14 }]],
    });
    const req = baseReq({ body: { Id: 0, LeadID: 21 } });
    const res = mockRes();
    await followupController.save(req, res);

    expect(database.executeStoredProcedure).toHaveBeenNthCalledWith(
      1,
      "sp_SaveFollowUp",
      expect.objectContaining({ LeadId: 21 }),
    );
  });

  it("returns error status when SP rejects", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 400, ResponseMess: "LeadId required" }]],
    });
    const req = baseReq({ body: { Id: 0 } });
    const res = mockRes();
    await followupController.save(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].success).toBe(false);
    expect(res.json.mock.calls[0][0].data).toBeNull();
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({ body: { Id: 0, LeadId: 9 } });
    const res = mockRes();
    await followupController.save(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("FOLLOWUP_SAVE_ERROR");
  });
});

describe("followupController.fetch", () => {
  it("forwards LeadId, paging, and accessible branch scope, then cleans rows", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [
          {
            ResponseCode: 200,
            ResponseMess: "Fetched",
            TotalRecords: 1,
            TotalPages: 1,
            CurrentPage: 1,
            PageSize: 10,
            Id: 1,
            LeadId: 9,
          },
        ],
      ],
    });
    const req = baseReq({
      body: { LeadId: 9, PageNumber: 1, PageSize: 10 },
      scope: { branchIds: [2, 3] },
    });
    const res = mockRes();
    await followupController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchFollowUp",
      expect.objectContaining({
        LeadId: 9,
        AccessibleBranchIdsJson: JSON.stringify([2, 3]),
        PageNumber: 1,
        PageSize: 10,
      }),
    );
    const json = res.json.mock.calls[0][0];
    expect(json.data.followups).toEqual([{ Id: 1, LeadId: 9 }]);
    expect(json.data.pagination).toEqual({
      currentPage: 1,
      pageSize: 10,
      totalRecords: 1,
      totalPages: 1,
    });
  });

  it("defaults LeadId to 0 and AccessibleBranchIdsJson to null when scope is empty", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "Fetched", TotalRecords: 0, TotalPages: 0, CurrentPage: 1, PageSize: 10 }]],
    });
    const req = baseReq();
    const res = mockRes();
    await followupController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchFollowUp",
      expect.objectContaining({ LeadId: 0, AccessibleBranchIdsJson: null }),
    );
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq();
    const res = mockRes();
    await followupController.fetch(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("FOLLOWUP_FETCH_ERROR");
  });
});

describe("followupController.delete", () => {
  it("deletes by Id and returns success", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "Deleted" }]],
    });
    const req = baseReq({ body: { Id: 12 } });
    const res = mockRes();
    await followupController.delete(req, res);

    expect(database.executeStoredProcedure).toHaveBeenNthCalledWith(1, "sp_DeleteFollowUp", { Id: 12 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({ body: { Id: 12 } });
    const res = mockRes();
    await followupController.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("FOLLOWUP_DELETE_ERROR");
  });
});
