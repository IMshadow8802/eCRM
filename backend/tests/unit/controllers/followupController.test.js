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

// Guard lookup: save/delete now verify the caller can see the follow-up's
// lead (sp_FetchLeadDetail + canSeeRecord) before mutating.
function mockLeadLookup(lead) {
  database.executeStoredProcedure.mockResolvedValueOnce({
    recordsets: [lead ? [lead] : [], [], []],
  });
}
const visibleLead = { Id: 9, BranchId: 2, OwnerId: 7, CreatedBy: 7 };

describe("followupController.save", () => {
  it("passes SourceCallId through to sp_SaveFollowUp when provided", async () => {
    mockLeadLookup(visibleLead);
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
      2,
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
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "Saved", FollowUpId: 13 }]],
    });
    const req = baseReq({ body: { Id: 0, LeadId: 9 } });
    const res = mockRes();
    await followupController.save(req, res);

    expect(database.executeStoredProcedure).toHaveBeenNthCalledWith(
      2,
      "sp_SaveFollowUp",
      expect.objectContaining({ SourceCallId: null }),
    );
  });

  it("accepts legacy LeadID field name", async () => {
    mockLeadLookup({ Id: 21, BranchId: 2, OwnerId: 7, CreatedBy: 7 });
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "Saved", FollowUpId: 14 }]],
    });
    const req = baseReq({ body: { Id: 0, LeadID: 21 } });
    const res = mockRes();
    await followupController.save(req, res);

    expect(database.executeStoredProcedure).toHaveBeenNthCalledWith(
      2,
      "sp_SaveFollowUp",
      expect.objectContaining({ LeadId: 21 }),
    );
  });

  it("returns error status when SP rejects", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 400, ResponseMess: "NextFollowupDate required" }]],
    });
    const req = baseReq({ body: { Id: 0, LeadId: 9 } });
    const res = mockRes();
    await followupController.save(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].success).toBe(false);
    expect(res.json.mock.calls[0][0].data).toBeNull();
  });

  // REGRESSION: save used to trust the client-supplied LeadId — a Self-scoped
  // exec could attach follow-ups to any colleague's lead.
  it("403s saving a follow-up on a lead the caller cannot see", async () => {
    mockLeadLookup({ Id: 9, BranchId: 2, OwnerId: 3, CreatedBy: 3 });
    const req = baseReq({
      scope: { branchIds: [2], ownerIds: [7] },
      body: { Id: 0, LeadId: 9 },
    });
    const res = mockRes();
    await followupController.save(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1); // lookup only
  });

  it("handles DB error as 500", async () => {
    mockLeadLookup(visibleLead);
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

  it("forwards the Status filter to sp_FetchFollowUp", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "Fetched", TotalRecords: 0, TotalPages: 0, CurrentPage: 1, PageSize: 10 }]],
    });
    const req = baseReq({ body: { Status: "Pending" } });
    const res = mockRes();
    await followupController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchFollowUp",
      expect.objectContaining({ Status: "Pending" }),
    );
  });

  it("defaults Status to null (no filter) when absent", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "Fetched", TotalRecords: 0, TotalPages: 0, CurrentPage: 1, PageSize: 10 }]],
    });
    const req = baseReq();
    const res = mockRes();
    await followupController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchFollowUp",
      expect.objectContaining({ Status: null }),
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
  // Delete resolves the follow-up's lead first (sp_FetchFollowUp by Id), then
  // guards the lead, then deletes.
  function mockFollowupLookup(row) {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[row]],
    });
  }

  it("deletes by Id after verifying the follow-up's lead is visible", async () => {
    mockFollowupLookup({ ResponseCode: 200, Id: 12, LeadId: 9 });
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "Deleted" }]],
    });
    const req = baseReq({ body: { Id: 12 } });
    const res = mockRes();
    await followupController.delete(req, res);

    expect(database.executeStoredProcedure).toHaveBeenNthCalledWith(1, "sp_FetchFollowUp", { Id: 12 });
    expect(database.executeStoredProcedure).toHaveBeenNthCalledWith(3, "sp_DeleteFollowUp", { Id: 12, CompId: 5 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it("404s when the follow-up does not exist", async () => {
    mockFollowupLookup({ ResponseCode: 404, ResponseMess: "Follow-up not found" });
    const req = baseReq({ body: { Id: 99 } });
    const res = mockRes();
    await followupController.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  // REGRESSION: delete used to take any Id with no ownership check at all.
  it("403s deleting a follow-up whose lead the caller cannot see", async () => {
    mockFollowupLookup({ ResponseCode: 200, Id: 12, LeadId: 9 });
    mockLeadLookup({ Id: 9, BranchId: 9, OwnerId: 3, CreatedBy: 3 });
    const req = baseReq({
      scope: { branchIds: [2], ownerIds: [7] },
      body: { Id: 12 },
    });
    const res = mockRes();
    await followupController.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2); // no delete call
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
