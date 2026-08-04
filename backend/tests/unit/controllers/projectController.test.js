jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));
jest.mock("../../../src/utils/activityLogger", () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  ACTIONS: { CREATED: "Created", UPDATED: "Updated", DELETED: "Deleted" },
}));

const database = require("../../../src/config/database");
const { logActivity } = require("../../../src/utils/activityLogger");
const projectController = require("../../../src/controllers/projectController");
const { mockRes } = require("../../helpers/mockRes");

// Characterisation suite, written BEFORE a refactor. Every assertion below
// describes what the controller does today — bugs included. `// BUG:` marks a
// behaviour that is wrong but deliberately pinned so the refactor cannot
// change it silently; fixing one of these means editing the test on purpose.

function baseReq(overrides = {}) {
  return {
    user: { UserId: 7, CompId: 5, BranchId: 2, IsAdmin: false },
    body: {},
    scope: { branchIds: [2], ownerIds: [] },
    ip: "127.0.0.1",
    headers: {},
    ...overrides,
  };
}

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
});

// ---------------------------------------------------------------------------
// save
// ---------------------------------------------------------------------------
describe("projectController.save", () => {
  const created = {
    recordsets: [
      [{ ResponseCode: 201, ResponseMess: "Project created successfully", ProjectId: 42 }],
    ],
  };

  it("calls sp_SaveProject with the full param set and logs a create", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(created);
    const req = baseReq({
      body: {
        Id: 0,
        Name: "Apollo",
        Description: "Rebuild the thing",
        ManagerUserId: 3,
        TeamId: 4,
        Members: [11, 12],
        Status: "active",
        Priority: "high",
        StartDate: "2026-08-01",
        EndDate: "2026-09-01",
        Budget: 1500,
        Progress: 10,
      },
    });
    const res = mockRes();

    await projectController.save(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_SaveProject", {
      Id: 0,
      Name: "Apollo",
      Description: "Rebuild the thing",
      ManagerUserId: 3,
      TeamId: 4,
      Members: "[11,12]",
      Status: "active",
      Priority: "high",
      StartDate: "2026-08-01",
      EndDate: "2026-09-01",
      Budget: 1500,
      Progress: 10,
      CompId: 5,
      BranchId: 2,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: true,
      message: "Project created successfully",
      responseCode: 201,
      data: { projectId: 42 },
    });
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "Project",
        entityId: 42,
        action: "Created",
        description: "Project Apollo created",
        req,
      }),
    );
  });

  it("applies the documented defaults when the body omits them", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(created);
    const req = baseReq({ body: { Name: "Bare", ManagerUserId: 3 } });
    const res = mockRes();

    await projectController.save(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SaveProject",
      expect.objectContaining({
        Id: 0,
        Status: "active",
        Priority: "medium",
        Budget: 0,
        Progress: 0,
      }),
    );
  });

  it("takes CompId/BranchId from req.user and ignores the body's", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(created);
    const req = baseReq({
      body: { Name: "Apollo", ManagerUserId: 3, CompId: 999, BranchId: 888 },
    });
    const res = mockRes();

    await projectController.save(req, res);

    const params = database.executeStoredProcedure.mock.calls[0][1];
    expect(params.CompId).toBe(5);
    expect(params.BranchId).toBe(2);
  });

  it("logs an update (not a create) when Id > 0", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ ResponseCode: 200, ResponseMess: "Project updated successfully", ProjectId: 42 }],
      ],
    });
    const req = baseReq({ body: { Id: 42, Name: "Apollo", ManagerUserId: 3 } });
    const res = mockRes();

    await projectController.save(req, res);

    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "Updated",
        description: "Project Apollo updated",
        entityId: 42,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("passes a Members string straight through without re-stringifying", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(created);
    const req = baseReq({
      body: { Name: "Apollo", ManagerUserId: 3, Members: "[11,12]" },
    });
    const res = mockRes();

    await projectController.save(req, res);

    expect(database.executeStoredProcedure.mock.calls[0][1].Members).toBe("[11,12]");
  });

  // BUG: `typeof Members === "object"` is true for null, so an explicit
  // `Members: null` is JSON.stringify'd into the four-character string "null"
  // and written verbatim into tblProjects.Members. sp_FetchProject then runs
  // JSON_VALUE(p.Members,'$') LIKE '%<UserId>%' over it — "null" matches
  // nothing, so the project becomes invisible to every non-admin non-manager.
  // It should send SQL NULL (i.e. skip the stringify for null).
  it("turns an explicit Members: null into the literal string 'null'", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(created);
    const req = baseReq({ body: { Name: "Apollo", ManagerUserId: 3, Members: null } });
    const res = mockRes();

    await projectController.save(req, res);

    expect(database.executeStoredProcedure.mock.calls[0][1].Members).toBe("null");
  });

  it("leaves Members undefined when the body omits it", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(created);
    const req = baseReq({ body: { Name: "Apollo", ManagerUserId: 3 } });
    const res = mockRes();

    await projectController.save(req, res);

    expect(database.executeStoredProcedure.mock.calls[0][1].Members).toBeUndefined();
  });

  // BUG: the create/update decision is `Id === 0`, a strict compare against a
  // number. A client sending the string "0" (any form-encoded or querystring
  // client) is a create as far as SQL Server is concerned — @Id INT coerces
  // it — but the audit trail records "Updated" for a row that was just
  // inserted. Should be `Number(Id) === 0`.
  it("mislabels a create as an update when Id arrives as the string '0'", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(created);
    const req = baseReq({ body: { Id: "0", Name: "Apollo", ManagerUserId: 3 } });
    const res = mockRes();

    await projectController.save(req, res);

    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "Updated", description: "Project Apollo updated" }),
    );
  });

  // BUG: save never consults req.scope, and sp_SaveProject's update path gates
  // on CompId alone. Any authenticated user in the company can therefore
  // rename, re-budget, or reassign the manager of ANY project in any branch by
  // posting its Id — the branch/membership fence that guards fetch and delete
  // is simply absent from the write path. (Matches the "write path does not
  // check ownership" known-open in ROLES.md.)
  it("sends no scope parameters at all, so the write path is unfenced", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "Project updated successfully", ProjectId: 99 }]],
    });
    const req = baseReq({
      // Caller can see branch 2 only; project 99 lives elsewhere.
      scope: { branchIds: [2], ownerIds: [7] },
      body: { Id: 99, Name: "Someone else's project", ManagerUserId: 3 },
    });
    const res = mockRes();

    await projectController.save(req, res);

    const params = database.executeStoredProcedure.mock.calls[0][1];
    expect(params).not.toHaveProperty("AccessibleBranchIdsJson");
    expect(params).not.toHaveProperty("UserId");
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // BUG: there is no controller-side validation whatsoever — an empty body
  // reaches the database with Name/ManagerUserId undefined, and projectRoutes
  // does not apply requirePayload either (teamRoutes does). The SP's 400 is
  // the only guard; delete validates in the controller, save does not.
  it("hits the database even with a completely empty body", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 400, ResponseMess: "Project name is required" }]],
    });
    const req = baseReq({ body: {} });
    const res = mockRes();

    await projectController.save(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SaveProject",
      expect.objectContaining({ Name: undefined, ManagerUserId: undefined, CompId: 5 }),
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // The SP rejects a blank Name, so this only bites if that guard is ever
  // relaxed — pinned because the fallback produces a description with a hole
  // in it ("Project  created") rather than anything a reader can act on.
  it("falls back to an empty name in the activity description", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(created);
    const req = baseReq({ body: { ManagerUserId: 3 } });
    const res = mockRes();

    await projectController.save(req, res);

    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Project  created" }),
    );
  });

  it("surfaces the SP's own code and message on a non-2xx, and logs nothing", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 400, ResponseMess: "Invalid project manager selected" }]],
    });
    const req = baseReq({ body: { Name: "Apollo", ManagerUserId: 4242 } });
    const res = mockRes();

    await projectController.save(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      message: "Invalid project manager selected",
      responseCode: 400,
      data: null,
    });
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("does not log when the SP succeeds but returns no ProjectId", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "Nothing to do" }]],
    });
    const req = baseReq({ body: { Id: 42, Name: "Apollo", ManagerUserId: 3 } });
    const res = mockRes();

    await projectController.save(req, res);

    expect(logActivity).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data).toEqual({ projectId: undefined });
  });

  it("500s with PROJECT_SAVE_ERROR when the database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({ body: { Name: "Apollo", ManagerUserId: 3 } });
    const res = mockRes();

    await projectController.save(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      message: "Failed to save project",
      code: "PROJECT_SAVE_ERROR",
      responseCode: 500,
    });
    expect(logActivity).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------
describe("projectController.fetch", () => {
  const twoProjects = {
    recordsets: [
      [
        {
          ResponseCode: 200,
          ResponseMess: "Projects retrieved successfully",
          TotalRecords: 2,
          TotalPages: 1,
          CurrentPage: 1,
          PageSize: 10,
          Id: 1,
          Name: "Apollo",
          BranchId: 2,
        },
        {
          ResponseCode: 200,
          ResponseMess: "Projects retrieved successfully",
          TotalRecords: 2,
          TotalPages: 1,
          CurrentPage: 1,
          PageSize: 10,
          Id: 2,
          Name: "Gemini",
          BranchId: 2,
        },
      ],
    ],
  };

  it("calls sp_FetchProject with the full param set and unwraps the rows", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(twoProjects);
    const req = baseReq({ body: {} });
    const res = mockRes();

    await projectController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchProject", {
      Id: 0,
      UserId: 7,
      CompId: 5,
      BranchId: 2,
      IsAdmin: false,
      AccessibleBranchIdsJson: "[2]",
      PageNumber: 1,
      PageSize: 10,
      SearchTerm: null,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    // cleanSpRows strips the envelope columns off every row.
    expect(body.data.projects).toEqual([
      { Id: 1, Name: "Apollo", BranchId: 2 },
      { Id: 2, Name: "Gemini", BranchId: 2 },
    ]);
    expect(body.data.pagination).toEqual({
      currentPage: 1,
      pageSize: 10,
      totalRecords: 2,
      totalPages: 1,
    });
  });

  it("passes body paging and search through", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(twoProjects);
    const req = baseReq({
      body: { Id: 9, PageNumber: 3, PageSize: 25, SearchTerm: "apollo" },
    });
    const res = mockRes();

    await projectController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchProject",
      expect.objectContaining({
        Id: 9,
        PageNumber: 3,
        PageSize: 25,
        SearchTerm: "apollo",
      }),
    );
  });

  /**
   * SECURITY, do not relax. An empty branch scope must serialise as the string
   * "[]" and never as null. sp_FetchProject reads NULL as "@UseScope = 0",
   * i.e. apply no branch filter at all — the widest possible answer for the
   * narrowest possible scope. "[]" is an empty allow-list and matches nothing.
   */
  it("serialises an empty scope as '[]', never null", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(twoProjects);
    const req = baseReq({ scope: { branchIds: [], ownerIds: [] } });
    const res = mockRes();

    await projectController.fetch(req, res);

    const params = database.executeStoredProcedure.mock.calls[0][1];
    expect(params.AccessibleBranchIdsJson).toBe("[]");
    expect(params.AccessibleBranchIdsJson).not.toBeNull();
  });

  it("falls back to null only when req.scope is absent entirely", async () => {
    // loadScope always runs on this route, so in production this is
    // unreachable; pinned because it is the one path that disables the branch
    // filter, and a refactor must not widen it to reachable code.
    database.executeStoredProcedure.mockResolvedValueOnce(twoProjects);
    const req = baseReq({ scope: undefined });
    const res = mockRes();

    await projectController.fetch(req, res);

    expect(
      database.executeStoredProcedure.mock.calls[0][1].AccessibleBranchIdsJson,
    ).toBeNull();
  });

  it("takes CompId from req.user and ignores the body's", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(twoProjects);
    const req = baseReq({ body: { CompId: 999, UserId: 999, IsAdmin: true } });
    const res = mockRes();

    await projectController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchProject",
      expect.objectContaining({ CompId: 5, UserId: 7, IsAdmin: false }),
    );
  });

  it("drops the SP's all-NULL placeholder row from an empty result", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [
          {
            ResponseCode: 200,
            ResponseMess: "No projects found",
            TotalRecords: 0,
            TotalPages: 0,
            CurrentPage: 1,
            PageSize: 10,
            Id: null,
            Name: null,
          },
        ],
      ],
    });
    const req = baseReq();
    const res = mockRes();

    await projectController.fetch(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.data.projects).toEqual([]);
    expect(body.data.pagination.totalRecords).toBe(0);
    expect(body.success).toBe(true);
  });

  it("surfaces a non-200 with the SP's own code and message", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 404, ResponseMess: "Project not found", Id: null }]],
    });
    const req = baseReq({ body: { Id: 999 } });
    const res = mockRes();

    await projectController.fetch(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      message: "Project not found",
      responseCode: 404,
    });
  });

  it("500s with PROJECT_FETCH_ERROR when the database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq();
    const res = mockRes();

    await projectController.fetch(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      message: "Failed to fetch projects",
      code: "PROJECT_FETCH_ERROR",
      responseCode: 500,
    });
  });

  // BUG: an SP that returns an empty first recordset (no rows at all, e.g. a
  // RETURN before any SELECT) makes `result.recordsets[0][0]` undefined, and
  // reading .ResponseCode off it throws — the caller gets an opaque 500
  // instead of anything actionable. Every fetch in this file has the shape.
  it("turns an empty recordset into an opaque 500", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    const req = baseReq();
    const res = mockRes();

    await projectController.fetch(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("PROJECT_FETCH_ERROR");
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------
// BUG: projectController.delete is unreachable. projectRoutes.js registers
// only /saveProject and /fetchProjects — there is no /deleteProject route, so
// this whole method is dead code. Tested anyway because it is exported, and
// because whoever wires the route next inherits this exact contract.
describe("projectController.delete", () => {
  it("calls sp_DeleteProject with the full param set and logs the delete", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "Project deleted successfully" }]],
    });
    const req = baseReq({ body: { Id: 42 } });
    const res = mockRes();

    await projectController.delete(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_DeleteProject", {
      Id: 42,
      UserId: 7,
      CompId: 5,
      BranchId: 2,
      IsAdmin: false,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: true,
      message: "Project deleted successfully",
      responseCode: 200,
    });
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "Project",
        entityId: 42,
        action: "Deleted",
        description: "Project deleted",
        req,
      }),
    );
  });

  it("takes CompId from req.user and ignores the body's", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "Project deleted successfully" }]],
    });
    const req = baseReq({ body: { Id: 42, CompId: 999, IsAdmin: true } });
    const res = mockRes();

    await projectController.delete(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_DeleteProject",
      expect.objectContaining({ CompId: 5, IsAdmin: false }),
    );
  });

  it.each([
    ["missing", {}],
    ["zero", { Id: 0 }],
    ["negative", { Id: -1 }],
  ])("400s on a %s Id, before touching the database", async (_label, body) => {
    const req = baseReq({ body });
    const res = mockRes();

    await projectController.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      message: "Project ID is required",
      code: "VALIDATION_ERROR",
      responseCode: 400,
    });
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("surfaces the SP's 409 and logs nothing when the project has tasks", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ ResponseCode: 409, ResponseMess: "Cannot delete project - has tasks. Please delete all tasks first" }],
      ],
    });
    const req = baseReq({ body: { Id: 42 } });
    const res = mockRes();

    await projectController.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      responseCode: 409,
      message: "Cannot delete project - has tasks. Please delete all tasks first",
    });
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("500s with PROJECT_DELETE_ERROR when the database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({ body: { Id: 42 } });
    const res = mockRes();

    await projectController.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      message: "Failed to delete project",
      code: "PROJECT_DELETE_ERROR",
      responseCode: 500,
    });
    expect(logActivity).not.toHaveBeenCalled();
  });
});
