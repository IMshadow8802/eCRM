jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const leadController = require("../../../src/controllers/leadController");
const { mockRes } = require("../../helpers/mockRes");

// Routes always run loadScope, so req.scope is present on every real request.
// Default here mirrors a Branch-scoped user (sees their branch, no ownership
// filter).
function baseReq(overrides = {}) {
  return {
    user: { UserId: 7, CompId: 5, BranchId: 2, IsAdmin: false },
    scope: {
      hierarchyLevel: 3,
      dataScope: "Branch",
      primaryBranchId: 2,
      branchIds: [2],
      ownerIds: null,
      canWriteBranchIds: [2],
      isAdmin: false,
    },
    body: {},
    ...overrides,
  };
}

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
});

// Guard lookup: mutations now fetch the lead (sp_FetchLeadDetail) and apply
// canSeeRecord before running the mutating SP.
function mockLeadLookup(lead) {
  database.executeStoredProcedure.mockResolvedValueOnce({
    recordsets: [lead ? [lead] : [], [], []],
  });
}
const visibleLead = { Id: 9, BranchId: 2, OwnerId: 7, CreatedBy: 7 };

describe("leadController.save", () => {
  it("injects CompId/BranchId/UserId and passes CustomJSON through unchanged", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Saved", Id: 42 }],
    });
    const req = baseReq({
      body: {
        Id: 0,
        Name: "Acme Corp",
        MobileNo: "9999999999",
        SourceId: 1,
        PipelineId: 1,
        StageId: 2,
        CustomJSON: '[{"fieldId":3,"type":"text","value":"blue"}]',
      },
    });
    const res = mockRes();
    await leadController.save(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SaveLead",
      expect.objectContaining({
        Id: 0,
        CompId: 5,
        BranchId: 2,
        UserId: 7,
        Name: "Acme Corp",
        CustomJSON: '[{"fieldId":3,"type":"text","value":"blue"}]',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].success).toBe(true);
    expect(res.json.mock.calls[0][0].data.Id).toBe(42);
  });

  it("returns error status when SP rejects (e.g. validation failure)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 400, ResponseMess: "Name required" }],
    });
    const req = baseReq({ body: { Id: 0 } });
    const res = mockRes();
    await leadController.save(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({ body: { Id: 0, Name: "X" } });
    const res = mockRes();
    await leadController.save(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("leadController.fetch", () => {
  // REGRESSION: fetch used to pass req.user.BranchId as the visibility filter,
  // so a sales lead raised in another branch was invisible to everyone outside
  // it. Visibility must come from req.scope instead.
  it("passes scope (not the caller's own BranchId) as the visibility filter", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    const req = baseReq({ scope: { branchIds: [1, 2, 3, 4, 5], ownerIds: null }, body: {} });
    const res = mockRes();
    await leadController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchLeads",
      expect.objectContaining({
        UserId: 7,
        AccessibleBranchIdsJson: "[1,2,3,4,5]",
        OwnerIdsJson: null, // wide scope -> no ownership filter
        BranchId: null, // not the caller's branch
      }),
    );
  });

  // A sales exec must not see a colleague's pipeline.
  it("sends an ownership filter for a Self-scoped sales executive", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    const req = baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: {} });
    const res = mockRes();
    await leadController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchLeads",
      expect.objectContaining({ AccessibleBranchIdsJson: "[2]", OwnerIdsJson: "[7]" }),
    );
  });

  it("forwards CompId + optional filters and maps rows + pagination recordsets", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ Id: 1, Name: "Acme" }, { Id: 2, Name: "Beta" }],
        [{ TotalRecords: 2, TotalPages: 1, CurrentPage: 1, PageSize: 10 }],
      ],
    });
    const req = baseReq({
      body: { PageNumber: 1, PageSize: 10, StageId: 2, OwnerId: 3, SourceId: 1, SearchTerm: "ac" },
    });
    const res = mockRes();
    await leadController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchLeads",
      expect.objectContaining({
        CompId: 5,
        PageNumber: 1,
        PageSize: 10,
        StageId: 2,
        OwnerId: 3,
        SourceId: 1,
        SearchTerm: "ac",
      }),
    );
    const json = res.json.mock.calls[0][0];
    expect(json.data.leads).toHaveLength(2);
    expect(json.data.pagination).toEqual({
      currentPage: 1,
      pageSize: 10,
      totalRecords: 2,
      totalPages: 1,
    });
  });

  it("defaults paging/filter params and pagination when recordsets are sparse", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    const req = baseReq();
    const res = mockRes();
    await leadController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchLeads",
      expect.objectContaining({ PageNumber: 1, PageSize: 10, SearchTerm: null }),
    );
    const json = res.json.mock.calls[0][0];
    expect(json.data.leads).toEqual([]);
    expect(json.data.pagination).toEqual({
      currentPage: 1,
      pageSize: 10,
      totalRecords: 0,
      totalPages: 1,
    });
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq();
    const res = mockRes();
    await leadController.fetch(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("leadController.detail", () => {
  it("maps the 3 recordsets to {lead, fields, activity}", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ Id: 9, Name: "Acme", BranchId: 2, OwnerId: 3, CreatedBy: 3 }],
        [{ FieldId: 1, Label: "Budget", ValueNumber: 5000 }],
        [{ Action: "created", CreatedAt: "2026-01-01" }],
      ],
    });
    const req = baseReq({ body: { LeadId: 9 } });
    const res = mockRes();
    await leadController.detail(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchLeadDetail",
      expect.objectContaining({ CompId: 5, LeadId: 9 }),
    );
    const json = res.json.mock.calls[0][0];
    expect(json.data.lead).toEqual({
      Id: 9,
      Name: "Acme",
      BranchId: 2,
      OwnerId: 3,
      CreatedBy: 3,
    });
    expect(json.data.fields).toEqual([{ FieldId: 1, Label: "Budget", ValueNumber: 5000 }]);
    expect(json.data.activity).toEqual([{ Action: "created", CreatedAt: "2026-01-01" }]);
  });

  // Without this the Self scope only fenced the *list*: a sales exec could post
  // any Id here and read a colleague's lead.
  it("404s a lead owned by someone else when the caller is Self-scoped", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 9, BranchId: 2, OwnerId: 3, CreatedBy: 3 }], [], []],
    });
    const req = baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { LeadId: 9 } });
    const res = mockRes();
    await leadController.detail(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("404s a lead from a branch outside the caller's scope", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 9, BranchId: 9, OwnerId: 3, CreatedBy: 3 }], [], []],
    });
    const req = baseReq({ scope: { branchIds: [2], ownerIds: null }, body: { LeadId: 9 } });
    const res = mockRes();
    await leadController.detail(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("shows a lead owned by the caller even from an out-of-scope branch", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 9, BranchId: 9, OwnerId: 7, CreatedBy: 3 }], [], []],
    });
    const req = baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { LeadId: 9 } });
    const res = mockRes();
    await leadController.detail(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("404s when the lead does not exist", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], [], []] });
    const req = baseReq({ body: { LeadId: 9 } });
    const res = mockRes();
    await leadController.detail(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({ body: { LeadId: 9 } });
    const res = mockRes();
    await leadController.detail(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("leadController.moveStage", () => {
  it("returns 400 when SP rejects lost-without-reason", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 400, ResponseMess: "Lost reason required" }],
    });
    const res = mockRes();
    await leadController.moveStage(baseReq({ body: { LeadId: 9, StageId: 5 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("calls sp_MoveLeadStage with CompId/UserId injected and succeeds", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Stage updated", Id: 9 }],
    });
    const req = baseReq({ body: { LeadId: 9, StageId: 3 } });
    const res = mockRes();
    await leadController.moveStage(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_MoveLeadStage",
      expect.objectContaining({ CompId: 5, LeadId: 9, StageId: 3, LostReasonId: null, UserId: 7 }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // REGRESSION: the write path used to trust the client-supplied LeadId — a
  // Self-scoped exec could move any colleague's lead by posting its Id.
  it("403s moving a lead the caller cannot see, without running the mutation", async () => {
    mockLeadLookup({ Id: 9, BranchId: 2, OwnerId: 3, CreatedBy: 3 });
    const req = baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { LeadId: 9, StageId: 3 } });
    const res = mockRes();
    await leadController.moveStage(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1); // lookup only
  });
});

describe("leadController.transfer", () => {
  it("calls sp_TransferLead with CompId/UserId injected", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Transferred", Id: 9 }],
    });
    const req = baseReq({ body: { LeadId: 9, OwnerId: 4 } });
    const res = mockRes();
    await leadController.transfer(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_TransferLead",
      expect.objectContaining({ CompId: 5, LeadId: 9, OwnerId: 4, UserId: 7 }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("403s transferring an out-of-branch lead the caller cannot see", async () => {
    mockLeadLookup({ Id: 9, BranchId: 9, OwnerId: 3, CreatedBy: 3 });
    const req = baseReq({ body: { LeadId: 9, OwnerId: 4 } });
    const res = mockRes();
    await leadController.transfer(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({ body: { LeadId: 9, OwnerId: 4 } });
    const res = mockRes();
    await leadController.transfer(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("leadController.delete", () => {
  it("calls sp_DeleteLead with Id first, then CompId", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Deleted" }],
    });
    const req = baseReq({ body: { Id: 9 } });
    const res = mockRes();
    await leadController.delete(req, res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_DeleteLead", { Id: 9, CompId: 5 });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("403s deleting a colleague's lead under Self scope", async () => {
    mockLeadLookup({ Id: 9, BranchId: 2, OwnerId: 3, CreatedBy: 3 });
    const req = baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { Id: 9 } });
    const res = mockRes();
    await leadController.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  it("falls back to ResponseMessage when ResponseMess is absent", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMessage: "Deleted via ResponseMessage" }],
    });
    const req = baseReq({ body: { Id: 9 } });
    const res = mockRes();
    await leadController.delete(req, res);
    expect(res.json.mock.calls[0][0].message).toBe("Deleted via ResponseMessage");
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({ body: { Id: 9 } });
    const res = mockRes();
    await leadController.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
