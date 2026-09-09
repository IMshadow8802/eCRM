jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));

const database = require("../../../src/config/database");
const leadController = require("../../../src/controllers/leadController");
const { mockRes } = require("../../helpers/mockRes");

// Routes always run loadScope, so req.scope is present on every real request.
// Default here mirrors a Branch-scoped user (sees their branch, no ownership
// filter, and wide enough for assertCanAssign's manager-only checks).
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

// Guard lookup: mutations fetch the lead (sp_FetchLeadDetail) and apply
// canSeeRecord before running the mutating SP. sp_FetchLeadDetail returns five
// recordsets since 071 (core, custom values, timeline, follow-ups, assignments).
function mockLeadLookup(lead) {
  database.executeStoredProcedure.mockResolvedValueOnce({
    recordsets: [lead ? [lead] : [], [], [], [], []],
  });
}
const visibleLead = { Id: 9, BranchId: 2, OwnerId: 7, CreatedBy: 7 };

// assertCanAssign's roster lookup (sp_FetchAssignableUsers).
function mockRoster(...ids) {
  database.executeStoredProcedure.mockResolvedValueOnce({
    recordsets: [ids.map((Id) => ({ Id }))],
  });
}

const EDIT_BODY = {
  Id: 9, Name: "Acme", Company: "Acme Ltd", MobileNo: "9", City: "Pune", Pincode: "411001",
  ProductId: 2, StatusId: 5, OwnerId: 3, EstValue: 50000, Remarks: "hot", FirstFollowupAt: "2026-09-10",
};

describe("leadController.save", () => {
  it("creates with the new fields, creator's branch, and no stage/pipeline", async () => {
    mockRoster(3); // OwnerId 3 is assignable by the caller
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Saved", Id: 42 }],
    });
    const res = mockRes();
    await leadController.save(baseReq({ body: { ...EDIT_BODY, Id: 0 } }), res);
    const [sp, params] = database.executeStoredProcedure.mock.calls[1];
    expect(sp).toBe("sp_SaveLead");
    expect(params).toMatchObject({
      Id: 0, CompId: 5, BranchId: 2, UserId: 7, Company: "Acme Ltd", City: "Pune",
      Pincode: "411001", ProductId: 2, StatusId: 5, OwnerId: 3, Remarks: "hot",
      FirstFollowupAt: "2026-09-10",
    });
    expect(params).not.toHaveProperty("PipelineId");
    expect(params).not.toHaveProperty("StageId");
    expect(res.json.mock.calls[0][0].data.Id).toBe(42);
  });

  // Ownership only moves through transfer (history) and status through
  // setStatus (guards). An edit must not be a side door for either.
  it("on edit, gates on the lead and drops OwnerId / StatusId / FirstFollowupAt", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Saved", Id: 9 }],
    });
    await leadController.save(baseReq({ body: EDIT_BODY }), mockRes());
    const params = database.executeStoredProcedure.mock.calls[1][1];
    expect(params).toMatchObject({ Id: 9, OwnerId: null, StatusId: null, FirstFollowupAt: null, Company: "Acme Ltd" });
  });

  it("403s an edit of a lead the caller cannot see", async () => {
    mockLeadLookup({ Id: 9, BranchId: 9, OwnerId: 3, CreatedBy: 3 });
    const res = mockRes();
    await leadController.save(baseReq({ body: EDIT_BODY }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  // REGRESSION: create was a side door around the assignment rule — transfer
  // checks the roster, so create must too.
  it("403s a create assigned to someone outside the caller's roster", async () => {
    mockRoster(4); // not 3
    const res = mockRes();
    await leadController.save(baseReq({ body: { ...EDIT_BODY, Id: 0 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1); // roster only
    expect(database.executeStoredProcedure).not.toHaveBeenCalledWith("sp_SaveLead", expect.anything());
  });

  it("skips the roster check for an unassigned create", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Saved", Id: 43 }],
    });
    const res = mockRes();
    await leadController.save(baseReq({ body: { ...EDIT_BODY, Id: 0, OwnerId: null } }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    const [sp, params] = database.executeStoredProcedure.mock.calls[0];
    expect(sp).toBe("sp_SaveLead");
    expect(params.OwnerId).toBeNull();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("returns the SP's validation status", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 400, ResponseMess: "Name is required" }],
    });
    const res = mockRes();
    await leadController.save(baseReq({ body: { Id: 0 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await leadController.save(baseReq({ body: { Id: 0, Name: "X" } }), res);
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
      body: { PageNumber: 1, PageSize: 10, StatusId: 2, OwnerId: 3, SourceId: 1, SearchTerm: "ac" },
    });
    const res = mockRes();
    await leadController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchLeads",
      expect.objectContaining({
        CompId: 5,
        PageNumber: 1,
        PageSize: 10,
        StatusId: 2,
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

  // REGRESSION: PageSize went from the body straight to the SP, so a single
  // request could ask SQL Server for every row the scope allows.
  it("clamps an oversized PageSize and echoes the clamped value", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    const res = mockRes();
    await leadController.fetch(baseReq({ body: { PageNumber: 2, PageSize: 99999 } }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchLeads",
      expect.objectContaining({ PageNumber: 2, PageSize: 200 }),
    );
    expect(res.json.mock.calls[0][0].data.pagination).toEqual({
      currentPage: 2,
      pageSize: 200,
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

describe("leadController.fetch filters", () => {
  it("forwards the new filters with booleans coerced", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await leadController.fetch(
      baseReq({ body: { StatusId: 5, StatusCode: "open", ProductId: 2, Overdue: 1, Unassigned: "true" } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchLeads",
      expect.objectContaining({ StatusId: 5, StatusCode: "open", ProductId: 2, Overdue: true, Unassigned: true }),
    );
    expect(database.executeStoredProcedure.mock.calls[0][1]).not.toHaveProperty("StageId");
  });

  it("defaults Overdue/Unassigned to false when absent", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await leadController.fetch(baseReq(), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchLeads",
      expect.objectContaining({ Overdue: false, Unassigned: false, StatusCode: null, ProductId: null }),
    );
  });
});

describe("leadController.detail", () => {
  it("maps the 5 recordsets", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ Id: 9, Name: "Acme", BranchId: 2, OwnerId: 3, CreatedBy: 3, StatusCode: "open" }],
        [{ FieldId: 1 }],
        [{ Id: 11, Type: "created" }],
        [{ Id: 21, Status: "open" }],
        [{ Id: 31, ToUserId: 3 }],
      ],
    });
    const res = mockRes();
    await leadController.detail(baseReq({ body: { LeadId: 9 } }), res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.lead.Id).toBe(9);
    expect(data.fields).toEqual([{ FieldId: 1 }]);
    expect(data.activity).toEqual([{ Id: 11, Type: "created" }]);
    expect(data.followups).toEqual([{ Id: 21, Status: "open" }]);
    expect(data.assignments).toEqual([{ Id: 31, ToUserId: 3 }]);
  });

  it("404s a lead owned by someone else when Self-scoped", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 9, BranchId: 2, OwnerId: 3, CreatedBy: 3 }], [], [], [], []],
    });
    const res = mockRes();
    await leadController.detail(baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { LeadId: 9 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("404s a lead from a branch outside the caller's scope", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 9, BranchId: 9, OwnerId: 3, CreatedBy: 3 }], [], [], [], []],
    });
    const req = baseReq({ scope: { branchIds: [2], ownerIds: null }, body: { LeadId: 9 } });
    const res = mockRes();
    await leadController.detail(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("shows a lead owned by the caller even from an out-of-scope branch", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 9, BranchId: 9, OwnerId: 7, CreatedBy: 3 }], [], [], [], []],
    });
    const req = baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { LeadId: 9 } });
    const res = mockRes();
    await leadController.detail(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("404s when the lead does not exist", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], [], [], [], []] });
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

describe("leadController.setStatus", () => {
  it("gates on the lead then calls sp_SetLeadStatus", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 9, ResponseCode: 200, ResponseMess: "Lead status updated successfully" }],
    });
    const res = mockRes();
    await leadController.setStatus(baseReq({ body: { LeadId: 9, StatusId: 6, LostReasonId: 2 } }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_SetLeadStatus", {
      CompId: 5, LeadId: 9, StatusId: 6, LostReasonId: 2, UserId: 7,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("passes the SP's 'Lost reason required' 400 through", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 9, ResponseCode: 400, ResponseMess: "Lost reason required" }],
    });
    const res = mockRes();
    await leadController.setStatus(baseReq({ body: { LeadId: 9, StatusId: 6 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // REGRESSION: the write path used to trust the client-supplied LeadId — a
  // Self-scoped exec could restatus any colleague's lead by posting its Id.
  it("403s a lead the caller cannot see, without running the mutation", async () => {
    mockLeadLookup({ Id: 9, BranchId: 2, OwnerId: 3, CreatedBy: 3 });
    const req = baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { LeadId: 9, StatusId: 6 } });
    const res = mockRes();
    await leadController.setStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1); // lookup only
  });
});

describe("leadController.transfer", () => {
  const body = { LeadId: 9, ToUserId: 3, ReasonId: 1, Remarks: "Absent" };

  it("gates on the lead, then the target, then transfers", async () => {
    mockLeadLookup(visibleLead);                                        // sp_FetchLeadDetail
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 3 }]] }); // roster
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 9, ResponseCode: 200, ResponseMess: "Lead transferred successfully" }],
    });
    const res = mockRes();
    await leadController.transfer(baseReq({ body }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_TransferLead", {
      CompId: 5, LeadId: 9, ToUserId: 3, ToBranchId: null, ReasonId: 1, Remarks: "Absent", UserId: 7,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("403s when the target is not assignable and never calls the SP", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 4 }]] });
    const res = mockRes();
    await leadController.transfer(baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2);
  });

  it("400s without remarks before touching the DB", async () => {
    const res = mockRes();
    await leadController.transfer(baseReq({ body: { ...body, Remarks: "  " } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("400s without a reason before touching the DB", async () => {
    const res = mockRes();
    await leadController.transfer(baseReq({ body: { ...body, ReasonId: null } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("403s transferring a lead the caller cannot see", async () => {
    mockLeadLookup({ Id: 9, BranchId: 9, OwnerId: 3, CreatedBy: 3 });
    const res = mockRes();
    await leadController.transfer(baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });
});

describe("leadController.bulkTransfer", () => {
  const body = { LeadIds: [9, 10], ToUserId: 3, ReasonId: 1, Remarks: "Back on duty" };

  it("checks every lead, the target once, then calls the bulk SP with JSON ids", async () => {
    mockLeadLookup(visibleLead);
    mockLeadLookup({ ...visibleLead, Id: 10 });
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 3 }]] });
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Transferred: 2, Skipped: 0, ResponseCode: 200, ResponseMess: "2 lead(s) transferred" }],
    });
    const res = mockRes();
    await leadController.bulkTransfer(baseReq({ body }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_BulkTransferLeads", {
      CompId: 5, LeadIdsJson: "[9,10]", ToUserId: 3, ToBranchId: null, ReasonId: 1, Remarks: "Back on duty", UserId: 7,
    });
    expect(res.json.mock.calls[0][0].data).toMatchObject({ Transferred: 2, Skipped: 0 });
  });

  it("400s on an empty id list", async () => {
    const res = mockRes();
    await leadController.bulkTransfer(baseReq({ body: { ...body, LeadIds: [] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("400s on more than 200 ids", async () => {
    const LeadIds = Array.from({ length: 201 }, (_, i) => i + 1);
    const res = mockRes();
    await leadController.bulkTransfer(baseReq({ body: { ...body, LeadIds } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("400s without a reason or remarks", async () => {
    const res = mockRes();
    await leadController.bulkTransfer(baseReq({ body: { ...body, Remarks: "" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("403s if any lead is out of scope", async () => {
    mockLeadLookup(visibleLead);
    mockLeadLookup({ Id: 10, BranchId: 9, OwnerId: 3, CreatedBy: 3 });
    const res = mockRes();
    await leadController.bulkTransfer(baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(403);
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

  it("returns the SP's error status", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 400, ResponseMess: "Lead not found" }],
    });
    const res = mockRes();
    await leadController.delete(baseReq({ body: { Id: 9 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("handles a failing sp_DeleteLead as 500", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await leadController.delete(baseReq({ body: { Id: 9 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("handles DB error as 500", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({ body: { Id: 9 } });
    const res = mockRes();
    await leadController.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
