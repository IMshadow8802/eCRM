jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));
jest.mock("../../../src/realtime/events", () => ({ emitToUser: jest.fn(), emitToWorkspace: jest.fn() }));

const database = require("../../../src/config/database");
const { emitToUser } = require("../../../src/realtime/events");
const { SCOPES } = require("../../../src/realtime/contract");
const leadController = require("../../../src/controllers/leadController");
const { mockRes } = require("../../helpers/mockRes");
const { accessForScope } = require("../../helpers/mockAccess");

// Routes always run loadScope, so req.scope is present on every real request.
// Default here mirrors a Branch-scoped user (sees their branch, no ownership
// filter, and wide enough for assertCanAssign's manager-only checks).
function rawReq(overrides = {}) {
  return {
    user: { UserId: 7, CompId: 5, BranchId: 2, IsAdmin: false },
    scope: {
      reach: "Office",
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

// Routes run loadScope, which sets req.access too; assertRecordAccess judges a
// record against the module scope it derives from req.access, so the access
// mirrors whatever scope shape a test describes.
const baseReq = (overrides = {}) => {
  const req = rawReq(overrides);
  if (!req.access) req.access = accessForScope(req.scope, req.user.UserId);
  return req;
};

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
  emitToUser.mockReset();
});

// Guard lookup: writes ask sp_FetchLeadDetail as the session person. Since 132
// it returns no row when the lead is not visible to them, and CanEdit on the
// row (a write needs it).
function mockLeadLookup(lead) {
  database.executeStoredProcedure.mockResolvedValueOnce({
    recordsets: [lead ? [lead] : [], [], [], [], []],
  });
}
const visibleLead = { Id: 9, BranchId: 2, OwnerId: 7, CreatedBy: 7, CanEdit: 1 };
const calls = (name) => database.executeStoredProcedure.mock.calls.filter((c) => c[0] === name);

const EDIT_BODY = {
  Id: 9, Name: "Acme", Company: "Acme Ltd", MobileNo: "9825012345", City: "Pune", Pincode: "411001",
  ProductId: 2, StatusId: 5, OwnerId: 3, EstValue: 50000, Remarks: "hot", FirstFollowupAt: "2026-09-10",
};

describe("leadController.save", () => {
  it("creates with the new fields, the live home office, and no stage/pipeline", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Lead saved successfully", Id: 42 }],
    });
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Id: 3, FullName: "Vinod Kumar" }]] });
    const req = baseReq({ body: { ...EDIT_BODY, Id: 0, UserId: 999, CompId: 999 } });
    req.access.primaryBranchId = 6; // moved office since sign-in; the token still says 2
    const res = mockRes();
    await leadController.save(req, res);
    const [sp, params] = database.executeStoredProcedure.mock.calls[0];
    expect(sp).toBe("sp_SaveLead");
    expect(params).toMatchObject({
      Id: 0, CompId: 5, BranchId: 6, UserId: 7, Company: "Acme Ltd", City: "Pune",
      Pincode: "411001", ProductId: 2, StatusId: 5, OwnerId: 3, Remarks: "hot",
      FirstFollowupAt: "2026-09-10",
    });
    expect(params).not.toHaveProperty("PipelineId");
    expect(params).not.toHaveProperty("StageId");
    expect(database.executeStoredProcedure.mock.calls[1]).toEqual(["sp_FetchAssignableUsers", {
      CompId: 5, UserId: 7, Module: "leads", RecordId: null, TargetUserId: 3,
    }]);
    expect(res.json.mock.calls[0][0].data.Id).toBe(42);
    expect(res.json.mock.calls[0][0].message).toBe("Lead saved and assigned to Vinod Kumar");
  });

  it("keeps the procedure's message when the name cannot be read", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordset: [{ ResponseCode: 200, ResponseMess: "Lead saved successfully", Id: 42 }] });
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await leadController.save(baseReq({ body: { ...EDIT_BODY, Id: 0 } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].message).toBe("Lead saved successfully");

    database.executeStoredProcedure.mockResolvedValueOnce({ recordset: [{ ResponseCode: 200, ResponseMess: "Lead saved successfully", Id: 43 }] });
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    const res2 = mockRes();
    await leadController.save(baseReq({ body: { ...EDIT_BODY, Id: 0 } }), res2);
    expect(res2.json.mock.calls[0][0].message).toBe("Lead saved successfully");
  });

  it("normalises FirstFollowupAt with a time to full ISO seconds before the SP", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordset: [{ ResponseCode: 200, ResponseMess: "Saved", Id: 42 }] });
    await leadController.save(baseReq({ body: { ...EDIT_BODY, Id: 0, OwnerId: null, FirstFollowupAt: "2026-11-17T11:00" } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1].FirstFollowupAt).toBe("2026-11-17T11:00:00");
  });

  it("400s a garbage FirstFollowupAt with no SP call", async () => {
    const res = mockRes();
    await leadController.save(baseReq({ body: { ...EDIT_BODY, Id: 0, FirstFollowupAt: "soon" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("sends a null FirstFollowupAt as null", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordset: [{ ResponseCode: 200, ResponseMess: "Saved", Id: 42 }] });
    await leadController.save(baseReq({ body: { ...EDIT_BODY, Id: 0, OwnerId: null, FirstFollowupAt: "" } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1].FirstFollowupAt).toBeNull();
  });

  // Ownership only moves through transfer (history) and status through
  // setStatus (guards). An edit must not be a side door for either.
  it("on edit, gates on the lead and drops OwnerId / StatusId / FirstFollowupAt", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Saved", Id: 9 }],
    });
    const res = mockRes();
    await leadController.save(baseReq({ body: EDIT_BODY }), res);
    expect(database.executeStoredProcedure.mock.calls[0]).toEqual(["sp_FetchLeadDetail", { CompId: 5, UserId: 7, LeadId: 9 }]);
    const params = database.executeStoredProcedure.mock.calls[1][1];
    expect(params).toMatchObject({ Id: 9, OwnerId: null, StatusId: null, FirstFollowupAt: null, Company: "Acme Ltd" });
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2); // no name lookup on edit
    expect(res.json.mock.calls[0][0].message).toBe("Saved");
  });

  it("404s an edit of a lead the caller cannot see (the procedure returns no row)", async () => {
    mockLeadLookup(null);
    const res = mockRes();
    await leadController.save(baseReq({ body: EDIT_BODY }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  it("403s an edit of a lead the caller can see but not edit (CanEdit 0)", async () => {
    mockLeadLookup({ ...visibleLead, CanEdit: 0 });
    const res = mockRes();
    await leadController.save(baseReq({ body: EDIT_BODY }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(calls("sp_SaveLead")).toHaveLength(0);
  });

  // The assign rule lives in sp_SaveLead now; Node asks no roster of its own.
  it("relays the procedure's 403 for a person outside the caller's assign list", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 0, ResponseCode: 403, ResponseMess: "You cannot assign records to that person" }],
    });
    const res = mockRes();
    await leadController.save(baseReq({ body: { ...EDIT_BODY, Id: 0 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].message).toBe("You cannot assign records to that person");
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    expect(calls("sp_FetchAssignableUsers")).toHaveLength(0);
  });

  it("an unassigned create is one call", async () => {
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

  // REGRESSION (2026-09-18): nothing normalised a mobile, so '+91 98250 12345'
  // and '9825012345' were two different leads and, after conversion, two
  // different customers.
  it("normalises the mobiles to ten digits before the SP sees them", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 200, ResponseMess: "Saved", Id: 44 }],
    });
    await leadController.save(
      baseReq({ body: { ...EDIT_BODY, Id: 0, OwnerId: null, MobileNo: "+91 98250-12345", AltMobile: "098250 99999" } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      MobileNo: "9825012345", AltMobile: "9825099999",
    });
  });

  it("400s a mobile that cannot be ten digits, before touching the DB", async () => {
    const res = mockRes();
    await leadController.save(baseReq({ body: { ...EDIT_BODY, Id: 0, MobileNo: "12345" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: "VALIDATION_ERROR", message: "Mobile number must be 10 digits" });
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("names the alternate mobile when that is the bad one", async () => {
    const res = mockRes();
    await leadController.save(baseReq({ body: { ...EDIT_BODY, Id: 0, AltMobile: "111" } }), res);
    expect(res.json.mock.calls[0][0].message).toBe("Alternate mobile must be 10 digits");
  });
});

describe("leadController.fetch", () => {
  // Visibility is the procedure's (132): Node sends the session person and
  // nothing that describes their reach.
  it("sends the session person, never an office or owner list, never the body's person", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    const req = baseReq({ scope: { branchIds: [1, 2, 3, 4, 5], ownerIds: [7] }, body: { UserId: 999, CompId: 999 } });
    await leadController.fetch(req, mockRes());
    const params = database.executeStoredProcedure.mock.calls[0][1];
    expect(params).toMatchObject({ CompId: 5, UserId: 7, BranchId: null });
    expect(params).not.toHaveProperty("AccessibleBranchIdsJson");
    expect(params).not.toHaveProperty("OwnerIdsJson");
  });

  // 119: rows go out as the SP returns them, so NextFollowupType reaches the
  // clients once applied, and its absence (DB without 119) is not an error.
  it("passes NextFollowupType through when the SP returns it, and copes when it does not", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 1, NextFollowupDate: "2026-11-04T11:00:00", NextFollowupType: "visit" }, { Id: 2 }], []],
    });
    const res = mockRes();
    await leadController.fetch(baseReq(), res);
    const [a, b] = res.json.mock.calls[0][0].data.leads;
    expect(a.NextFollowupType).toBe("visit");
    expect(b).not.toHaveProperty("NextFollowupType");
    // No new param: the SP call is the same before and after 119.
    expect(database.executeStoredProcedure.mock.calls[0][1]).not.toHaveProperty("NextFollowupType");
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

  // Report drill-downs arrive with the range they counted (spec 4a §5).
  it("forwards an ISO FromDate/ToDate and nulls anything else", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await leadController.fetch(baseReq({ body: { FromDate: "2026-08-01", ToDate: "2026-08-31" } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ FromDate: "2026-08-01", ToDate: "2026-08-31" });

    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await leadController.fetch(baseReq({ body: { FromDate: "01/08/2026", ToDate: 20260831 } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ FromDate: null, ToDate: null });
  });

  // 122 §6: a whitelisted column and direction, never a raw string.
  it.each([
    [{ SortBy: "lastActivity", SortDir: "asc" }, { SortBy: "lastActivity", SortDir: "asc" }],
    [{ SortBy: "value" }, { SortBy: "value", SortDir: "desc" }],
  ])("fetch sends sort %j as %j", async (body, sent) => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
    await leadController.fetch(baseReq({ body }), mockRes());
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchLeads", expect.objectContaining(sent));
  });

  // Regression: a DB without 122 §6 rejects unknown params, so with no (valid)
  // sort the keys must be absent, not null — or every Leads list 500s there.
  it.each([[{}], [{ SortBy: "CreatedAt; DROP", SortDir: "up" }], [{ SortDir: "asc" }]])(
    "fetch with no valid sort %j sends no SortBy/SortDir keys", async (body) => {
      database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], []] });
      await leadController.fetch(baseReq({ body }), mockRes());
      const params = database.executeStoredProcedure.mock.calls[0][1];
      expect(params).not.toHaveProperty("SortBy");
      expect(params).not.toHaveProperty("SortDir");
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

  it("asks the procedure as the session person and returns the action fields", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 9, OwnerId: 3, CanEdit: 1, CanReassign: 1, SendBackToId: 16, SendBackToName: "Neha" }], [], [], [], []],
    });
    const res = mockRes();
    await leadController.detail(baseReq({ body: { LeadId: "9", UserId: 999 } }), res);
    expect(database.executeStoredProcedure.mock.calls[0]).toEqual(["sp_FetchLeadDetail", { CompId: 5, UserId: 7, LeadId: 9 }]);
    expect(res.json.mock.calls[0][0].data.lead).toMatchObject({ CanEdit: 1, CanReassign: 1, SendBackToId: 16, SendBackToName: "Neha" });
  });

  // W3: Node no longer re-judges a row against req.scope lists. A row the
  // procedure returns is visible, whatever the old Own/Office lists said.
  it("W3 regression: shows a row the procedure returns even outside the old scope lists", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ Id: 9, BranchId: 9, OwnerId: 3, CreatedBy: 3 }], [], [], [], []],
    });
    const res = mockRes();
    await leadController.detail(baseReq({ scope: { branchIds: [2], ownerIds: [7] }, body: { LeadId: 9 } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("404s 'Lead not found' when the procedure returns no row (absent or not visible alike)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[], [], [], [], []] });
    const req = baseReq({ body: { LeadId: 9 } });
    const res = mockRes();
    await leadController.detail(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].message).toBe("Lead not found");
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
    expect(database.executeStoredProcedure.mock.calls.filter((c) => c[0] === "sp_SetLeadStatus")[0][1]).toEqual({
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
  it("404s a lead the caller cannot see, without running the mutation", async () => {
    mockLeadLookup(null);
    const req = baseReq({ body: { LeadId: 9, StatusId: 6 } });
    const res = mockRes();
    await leadController.setStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1); // lookup only
  });
});

describe("leadController.transfer", () => {
  const body = { LeadId: 9, ToUserId: 3, ReasonId: 1, Remarks: "Absent" };
  const moved = (extra = {}) => ({
    recordset: [{ Id: 9, ResponseCode: 200, ResponseMess: "Lead reassigned successfully", FromUserId: 7, ToUserId: 3, ToName: "Vinod", ...extra }],
  });

  it("gates on the lead, then reassigns in one procedure call and tells both holders", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce(moved());
    const res = mockRes();
    await leadController.transfer(baseReq({ body }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(2);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_TransferLead", {
      CompId: 5, LeadId: 9, ToUserId: 3, ToBranchId: null, ReasonId: 1, Remarks: "Absent", UserId: 7, SendBack: 0,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toMatchObject({ FromUserId: 7, ToUserId: 3, ToName: "Vinod" });
    expect(emitToUser).toHaveBeenCalledTimes(2);
    expect(emitToUser).toHaveBeenCalledWith(7, SCOPES.RECORDS, { module: "leads" });
    expect(emitToUser).toHaveBeenCalledWith(3, SCOPES.RECORDS, { module: "leads" });
  });

  it("send back needs remarks but no reason, and passes SendBack 1", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce(moved({ ResponseMess: "Lead sent back", ToUserId: 16 }));
    const res = mockRes();
    await leadController.transfer(baseReq({ body: { LeadId: 9, SendBack: true, Remarks: "Not mine" } }), res);
    expect(database.executeStoredProcedure).toHaveBeenLastCalledWith("sp_TransferLead", {
      CompId: 5, LeadId: 9, ToUserId: null, ToBranchId: null, ReasonId: null, Remarks: "Not mine", UserId: 7, SendBack: 1,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(emitToUser).toHaveBeenCalledWith(16, SCOPES.RECORDS, { module: "leads" });
  });

  it("send back without remarks 400s before the DB", async () => {
    const res = mockRes();
    await leadController.transfer(baseReq({ body: { LeadId: 9, SendBack: true, Remarks: " " } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("Remarks are required to send this back");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("unassign: one emit for the previous holder only", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce(moved({ ToUserId: null, ToName: null }));
    await leadController.transfer(baseReq({ body: { ...body, ToUserId: null } }), mockRes());
    expect(emitToUser).toHaveBeenCalledTimes(1);
    expect(emitToUser).toHaveBeenCalledWith(7, SCOPES.RECORDS, { module: "leads" });
  });

  // The assign rule (gates 1-8) is the procedure's; its answer goes out unchanged.
  it.each([
    [403, "You cannot assign records to that person"],
    [404, "Record not found"],
    [400, "There is nobody to send this back to."],
  ])("relays the procedure's %i and its message, and tells nobody", async (code, message) => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({ recordset: [{ Id: 9, ResponseCode: code, ResponseMess: message }] });
    const res = mockRes();
    await leadController.transfer(baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(code);
    expect(res.json.mock.calls[0][0].message).toBe(message);
    expect(emitToUser).not.toHaveBeenCalled();
  });

  it("legacy payload: without SendBack it still needs a reason and remarks", async () => {
    for (const patch of [{ Remarks: "  " }, { ReasonId: null }]) {
      const res = mockRes();
      await leadController.transfer(baseReq({ body: { ...body, ...patch } }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].message).toBe("A reason and remarks are required to reassign");
    }
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("400s without a LeadId before the DB", async () => {
    const res = mockRes();
    await leadController.transfer(baseReq({ body: { ...body, LeadId: "x" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("404s reassigning a lead the caller cannot see", async () => {
    mockLeadLookup(null);
    const res = mockRes();
    await leadController.transfer(baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  it("500s when the procedure throws", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await leadController.transfer(baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("leadController.bulkTransfer", () => {
  const body = { LeadIds: [9, 10, 9, "x"], ToUserId: 3, ReasonId: 1, Remarks: "Back on duty" };

  it("one procedure call, no per-id reads; tells every holder in the second result set", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Transferred: 2, Skipped: 0, Moved: 2, Refused: 0, ResponseCode: 200, ResponseMess: "2 lead(s) reassigned" }],
      recordsets: [
        [{ Transferred: 2, Skipped: 0, Moved: 2, Refused: 0, ResponseCode: 200, ResponseMess: "2 lead(s) reassigned" }],
        [{ UserId: 4 }, { UserId: 3 }, { UserId: 4 }],
      ],
    });
    const res = mockRes();
    await leadController.bulkTransfer(baseReq({ body }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_BulkTransferLeads", {
      CompId: 5, LeadIdsJson: "[9,10]", ToUserId: 3, ToBranchId: null, ReasonId: 1, Remarks: "Back on duty", UserId: 7,
    });
    expect(res.json.mock.calls[0][0].data).toMatchObject({ Moved: 2, Refused: 0 });
    expect(emitToUser.mock.calls).toEqual([
      [4, SCOPES.RECORDS, { module: "leads" }],
      [3, SCOPES.RECORDS, { module: "leads" }],
    ]);
  });

  // S7: all-or-nothing; the first failing gate's sentence with the count.
  it("Refused > 0: relays the gate's status and sentence with the count, tells nobody", async () => {
    const row = { Transferred: 0, Moved: 0, Refused: 2, ResponseCode: 403, ResponseMess: "Only a manager can reassign a closed record (2 of 5 refused)" };
    database.executeStoredProcedure.mockResolvedValueOnce({ recordset: [row], recordsets: [[row]] });
    const res = mockRes();
    await leadController.bulkTransfer(baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].message).toBe("Only a manager can reassign a closed record (2 of 5 refused)");
    expect(emitToUser).not.toHaveBeenCalled();
  });

  it("copes with a 200 that carries no holder list", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordset: [{ ResponseCode: 200, ResponseMess: "0 lead(s) reassigned" }] });
    const res = mockRes();
    await leadController.bulkTransfer(baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(emitToUser).not.toHaveBeenCalled();
  });

  it("0 ids and 201 ids are refused before any DB call", async () => {
    for (const LeadIds of [[], Array.from({ length: 201 }, (_, i) => i + 1), "9"]) {
      const res = mockRes();
      await leadController.bulkTransfer(baseReq({ body: { ...body, LeadIds } }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("400s without a reason or remarks", async () => {
    const res = mockRes();
    await leadController.bulkTransfer(baseReq({ body: { ...body, Remarks: "" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
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

  it("404s deleting a lead the caller cannot see", async () => {
    mockLeadLookup(null);
    const req = baseReq({ body: { Id: 9 } });
    const res = mockRes();
    await leadController.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
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

describe("leadController.convert", () => {
  const wonRow = { recordset: [{ Id: 9, ResponseCode: 200, ResponseMess: "Lead marked won", CustomerId: 31, WonValue: 4000 }] };

  // Small leads are won with no quotation at all (spec decision 6).
  it("wins a lead without a quotation, on the typed value", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce(wonRow);
    const res = mockRes();
    await leadController.convert(baseReq({ body: { LeadId: 9, WonValue: "4000", Remarks: " paid by UPI " } }), res);
    expect(database.executeStoredProcedure.mock.calls[1]).toEqual(["sp_ConvertLead", {
      CompId: 5, LeadId: 9, UserId: 7, WonValue: 4000, Remarks: "paid by UPI", QuotationId: null,
    }]);
    expect(res.json.mock.calls[0][0].data).toMatchObject({ CustomerId: 31, WonValue: 4000 });
  });

  // With a quotation the SP takes the value from it. The controller sends what
  // it was given and does not pre-empt that rule.
  it("accepts a quotation by id", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce(wonRow);
    await leadController.convert(baseReq({ body: { LeadId: 9, QuotationId: "42" } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[1][1]).toMatchObject({ QuotationId: 42, WonValue: null });
  });

  it("400s without a quotation AND without a value, before the DB", async () => {
    const res = mockRes();
    await leadController.convert(baseReq({ body: { LeadId: 9 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("Enter the value this lead was won for");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it.each([["-1"], ["abc"]])("400s a value of %p", async (WonValue) => {
    const res = mockRes();
    await leadController.convert(baseReq({ body: { LeadId: 9, WonValue } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("accepts a value of zero — a free replacement is still a win", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce(wonRow);
    await leadController.convert(baseReq({ body: { LeadId: 9, WonValue: 0 } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[1][1].WonValue).toBe(0);
  });

  it("404s a lead the caller cannot see", async () => {
    mockLeadLookup(null);
    const res = mockRes();
    await leadController.convert(baseReq({ body: { LeadId: 9, WonValue: 100 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });

  it("surfaces the SP's 409 (lead is lost / quotation not final)", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ Id: 9, ResponseCode: 409, ResponseMess: "Only a finalised quotation can be accepted" }],
    });
    const res = mockRes();
    await leadController.convert(baseReq({ body: { LeadId: 9, QuotationId: 42 } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  // A quotation supplies its own value — the SP ignores WonValue when one is
  // given, so a stale/junk WonValue must not block an otherwise valid win.
  it("ignores a junk WonValue when a quotation governs the win", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce(wonRow);
    const res = mockRes();
    await leadController.convert(baseReq({ body: { LeadId: 9, QuotationId: 42, WonValue: "not-a-number" } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(database.executeStoredProcedure.mock.calls[1][0]).toBe("sp_ConvertLead");
  });

  // Pins the rule down: the same junk value, with no quotation to supply the
  // number instead, is still rejected.
  it("still rejects that junk value with no quotation to cover it", async () => {
    const res = mockRes();
    await leadController.convert(baseReq({ body: { LeadId: 9, WonValue: "not-a-number" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it.each([[undefined], ["abc"]])("400s a LeadId of %p, before the DB", async (LeadId) => {
    const res = mockRes();
    await leadController.convert(baseReq({ body: { LeadId, WonValue: 100 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });
});

// A lead owned by someone else, out of the caller's view: the procedure
// returns no row. Detail and every write answer 404 (no hint it exists), every
// write before its mutation.
describe("a lead owned by someone else", () => {
  it("a lead owned by someone else answers 404 on detail and on every write", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[], [], [], [], []] });
    const res = mockRes();
    await leadController.detail(baseReq({ body: { LeadId: 9 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);

    for (const [method, body] of [
      ["save", { Id: 9, Name: "Acme" }],
      ["setStatus", { LeadId: 9, StatusId: 6 }],
      ["convert", { LeadId: 9, WonValue: 100 }],
      ["transfer", { LeadId: 9, ToUserId: 3, ReasonId: 1, Remarks: "Absent" }],
      ["transfer", { LeadId: 9, SendBack: true, Remarks: "Not mine" }],
      ["delete", { Id: 9 }],
    ]) {
      const r = mockRes();
      await leadController[method](baseReq({ body }), r);
      expect(r.status).toHaveBeenCalledWith(404);
    }
    const names = database.executeStoredProcedure.mock.calls.map((c) => c[0]);
    expect(new Set(names)).toEqual(new Set(["sp_FetchLeadDetail"]));
  });

  // Seen but not editable (CanEdit 0): writes 403 without the mutation.
  it.each([
    ["save (edit)", "save", { Id: 9, Name: "Acme" }],
    ["setStatus", "setStatus", { LeadId: 9, StatusId: 6 }],
    ["transfer", "transfer", { LeadId: 9, ToUserId: 3, ReasonId: 1, Remarks: "Absent" }],
    ["delete", "delete", { Id: 9 }],
  ])("403s %s on a lead without CanEdit", async (_label, method, body) => {
    mockLeadLookup({ ...visibleLead, CanEdit: 0 });
    const res = mockRes();
    await leadController[method](baseReq({ body }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
  });
});

describe("leadController partner (spec 2026-10-10, merged procs)", () => {
  const okRow = (Id = 42) => ({ recordset: [{ Id, ResponseCode: 200, ResponseMess: "ok" }] });
  const withPartners = (req) => {
    req.access.modules.partners = { view: true, add: false, edit: false, delete: false, reach: null };
    return req;
  };
  const create = (body, view) => {
    const req = baseReq({ body: { ...EDIT_BODY, Id: 0, OwnerId: null, ...body } });
    return view ? withPartners(req) : req;
  };

  it("save sends partner and terms in the one sp_SaveLead call, for a partners viewer", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow(42));
    const res = mockRes();
    await leadController.save(create({ PartnerId: 3, CommType: "pct", CommValue: 10 }, true), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledTimes(1);
    expect(calls("sp_SaveLead")[0][1]).toMatchObject({
      SetPartner: 1, PartnerId: 3, CommType: "pct", CommValue: 10, SetTerms: 1 });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("save by a caller without partners view never sends terms", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow(42));
    await leadController.save(create({ PartnerId: 3, CommType: "pct", CommValue: 10 }, false), mockRes());
    expect(calls("sp_SaveLead")[0][1]).toMatchObject({ SetPartner: 1, PartnerId: 3, SetTerms: 0, CommType: null, CommValue: null });
  });

  it("an explicit null PartnerId clears the partner", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow(9));
    await leadController.save(baseReq({ body: { ...EDIT_BODY, PartnerId: null } }), mockRes());
    expect(calls("sp_SaveLead")[0][1]).toMatchObject({ Id: 9, SetPartner: 1, PartnerId: null });
  });

  it.each([null, ""])("save 400s a type with CommValue %p instead of saving 0", async (v) => {
    const res = mockRes();
    await leadController.save(create({ PartnerId: 3, CommType: "pct", CommValue: v }, true), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("a viewer's save without a CommType key sends SetTerms 0; explicit null sends SetTerms 1", async () => {
    database.executeStoredProcedure.mockResolvedValue(okRow(42));
    await leadController.save(create({ PartnerId: 3 }, true), mockRes());
    expect(calls("sp_SaveLead")[0][1]).toMatchObject({ SetTerms: 0, CommType: null, CommValue: null });
    await leadController.save(create({ PartnerId: 3, CommType: null }, true), mockRes());
    expect(calls("sp_SaveLead")[1][1]).toMatchObject({ SetTerms: 1, CommType: null, CommValue: null });
  });

  describe("changing the partner on a won lead", () => {
    const won = { ...visibleLead, StatusCode: "converted", PartnerId: 3, CommType: "pct", CommValue: "10.00" };
    const edit = (req) => { req.access.modules.partners = { view: true, add: true, edit: true, delete: false, reach: null }; return req; };
    const body = (extra) => ({ ...EDIT_BODY, ...extra });

    it("403s a caller without partners edit changing the partner; no SP write", async () => {
      mockLeadLookup(won);
      const res = mockRes();
      await leadController.save(baseReq({ body: body({ PartnerId: 4 }) }), res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json.mock.calls[0][0].message).toBe("Only someone with commission rights can change the partner on a won lead");
      expect(calls("sp_SaveLead")).toHaveLength(0);
    });
    it("403s clearing the partner too", async () => {
      mockLeadLookup(won);
      const res = mockRes();
      await leadController.save(baseReq({ body: body({ PartnerId: null }) }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });
    it("403s a viewer changing the terms", async () => {
      mockLeadLookup(won);
      const res = mockRes();
      await leadController.save(withPartners(baseReq({ body: body({ PartnerId: 3, CommType: "pct", CommValue: 20 }) })), res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(calls("sp_SaveLead")).toHaveLength(0);
    });
    it("passes the same partner and terms re-sent", async () => {
      mockLeadLookup(won);
      database.executeStoredProcedure.mockResolvedValueOnce(okRow(9));
      await leadController.save(withPartners(baseReq({ body: body({ PartnerId: 3, CommType: "pct", CommValue: 10 }) })), mockRes());
      expect(calls("sp_SaveLead")).toHaveLength(1);
    });
    it("passes a partners-edit caller changing the partner", async () => {
      mockLeadLookup(won);
      database.executeStoredProcedure.mockResolvedValueOnce(okRow(9));
      await leadController.save(edit(baseReq({ body: body({ PartnerId: 4 }) })), mockRes());
      expect(calls("sp_SaveLead")[0][1]).toMatchObject({ PartnerId: 4 });
    });
    it("passes an unconverted lead without partners edit", async () => {
      mockLeadLookup({ ...won, StatusCode: "open" });
      database.executeStoredProcedure.mockResolvedValueOnce(okRow(9));
      await leadController.save(baseReq({ body: body({ PartnerId: 4 }) }), mockRes());
      expect(calls("sp_SaveLead")).toHaveLength(1);
    });
  });

  it("save 400s a whitespace-only CommValue instead of saving 0", async () => {
    const res = mockRes();
    await leadController.save(create({ PartnerId: 3, CommType: "pct", CommValue: "   " }, true), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("save without a PartnerId key sends SetPartner 0", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(okRow(42));
    await leadController.save(create({}, true), mockRes());
    expect(calls("sp_SaveLead")[0][1]).toMatchObject({ SetPartner: 0, PartnerId: null, CommType: null, CommValue: null, SetTerms: 0 });
  });

  it("save passes the proc's 409 straight through", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordset: [{ ResponseCode: 409, ResponseMess: "Commission already paid" }] });
    const res = mockRes();
    await leadController.save(create({ PartnerId: 3 }, false), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].message).toBe("Commission already paid");
  });

  it.each(["x", 0, -1])("save 400s a junk PartnerId (%p) instead of clearing the partner", async (bad) => {
    const res = mockRes();
    await leadController.save(create({ PartnerId: bad }, false), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("Pick a valid partner");
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("save on edit 400s bad terms before any DB call", async () => {
    const res = mockRes();
    await leadController.save(withPartners(baseReq({ body: { ...EDIT_BODY, PartnerId: 3, CommType: "pct", CommValue: 150 } })), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("save 400s bad terms before any DB call", async () => {
    const res = mockRes();
    await leadController.save(create({ PartnerId: 3, CommType: "pct", CommValue: 150 }, true), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("convert and setStatus make exactly one proc call (the procs sync inside)", async () => {
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow(9));
    await leadController.convert(baseReq({ body: { LeadId: 9, WonValue: 100 } }), mockRes());
    expect(calls("sp_ConvertLead")).toHaveLength(1);
    mockLeadLookup(visibleLead);
    database.executeStoredProcedure.mockResolvedValueOnce(okRow(9));
    await leadController.setStatus(baseReq({ body: { LeadId: 9, StatusId: 6 } }), mockRes());
    expect(calls("sp_SetLeadStatus")).toHaveLength(1);
    expect(calls("sp_SyncPartnerCommission")).toHaveLength(0);
  });

  it("fetch passes a positive-int PartnerId, nulls junk", async () => {
    database.executeStoredProcedure.mockResolvedValue({ recordsets: [[], []] });
    await leadController.fetch(baseReq({ body: { PartnerId: "3" } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1].PartnerId).toBe(3);
    await leadController.fetch(baseReq({ body: { PartnerId: "x" } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[1][1].PartnerId).toBeNull();
  });

  describe("detail", () => {
    const rs = {
      recordsets: [[{ Id: 9, OwnerId: 7, PartnerId: 3, PartnerName: "Sharma", CommType: "pct", CommValue: 10 }],
        [], [], [], [], [{ Id: 1, Amount: 5 }]] };

    it("strips terms and returns no commissions without partners view", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce(rs);
      const res = mockRes();
      await leadController.detail(baseReq({ body: { LeadId: 9 } }), res);
      const d = res.json.mock.calls[0][0].data;
      expect(d.commissions).toEqual([]);
      expect(d.lead).toMatchObject({ PartnerId: 3, PartnerName: "Sharma" });
      expect(d.lead).not.toHaveProperty("CommType");
      expect(d.lead).not.toHaveProperty("CommValue");
    });

    it("returns terms and the last result set as commissions with partners view", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce(rs);
      const res = mockRes();
      await leadController.detail(withPartners(baseReq({ body: { LeadId: 9 } })), res);
      const d = res.json.mock.calls[0][0].data;
      expect(d.commissions).toEqual([{ Id: 1, Amount: 5 }]);
      expect(d.lead).toMatchObject({ CommType: "pct", CommValue: 10 });
    });
  });
});
