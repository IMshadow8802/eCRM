jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));
jest.mock("../../../src/utils/activityLogger", () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  ACTIONS: { CREATED: "Created", UPDATED: "Updated", DELETED: "Deleted" },
}));

const database = require("../../../src/config/database");
const { logActivity } = require("../../../src/utils/activityLogger");
const teamController = require("../../../src/controllers/teamController");
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
describe("teamController.save", () => {
  const created = {
    recordsets: [
      [
        {
          ResponseCode: 201,
          ResponseMess: "Team created successfully",
          TeamId: 8,
          MemberCount: 2,
        },
      ],
    ],
  };

  it("calls sp_SaveTeam with the full param set and logs a create", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(created);
    const req = baseReq({
      body: {
        Id: 0,
        Name: "Ops",
        Description: "Keeps the lights on",
        LeadUserId: 3,
        Color: "#3F4FAF",
        Members: [11, 12],
        IsActive: true,
      },
    });
    const res = mockRes();

    await teamController.save(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_SaveTeam", {
      Id: 0,
      Name: "Ops",
      Description: "Keeps the lights on",
      LeadUserId: 3,
      Color: "#3F4FAF",
      Members: "[11,12]",
      IsActive: true,
      CompId: 5,
      BranchId: 2,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: true,
      message: "Team created successfully",
      responseCode: 201,
      data: { teamId: 8, memberCount: 2 },
    });
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "Team",
        entityId: 8,
        action: "Created",
        description: "Team Ops created (2 members)",
        req,
      }),
    );
  });

  it("applies the documented defaults when the body omits them", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(created);
    const req = baseReq({ body: { Name: "Ops" } });
    const res = mockRes();

    await teamController.save(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SaveTeam",
      expect.objectContaining({ Id: 0, IsActive: true, Members: null }),
    );
  });

  it("takes CompId/BranchId from req.user and ignores the body's", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(created);
    const req = baseReq({ body: { Name: "Ops", CompId: 999, BranchId: 888 } });
    const res = mockRes();

    await teamController.save(req, res);

    const params = database.executeStoredProcedure.mock.calls[0][1];
    expect(params.CompId).toBe(5);
    expect(params.BranchId).toBe(2);
  });

  it("logs an update (not a create) when Id > 0", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [
          {
            ResponseCode: 200,
            ResponseMess: "Team updated successfully",
            TeamId: 8,
            MemberCount: 3,
          },
        ],
      ],
    });
    const req = baseReq({ body: { Id: 8, Name: "Ops", Members: [1, 2, 3] } });
    const res = mockRes();

    await teamController.save(req, res);

    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "Updated",
        description: "Team Ops updated (3 members)",
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual({ teamId: 8, memberCount: 3 });
  });

  it("reports memberCount 0 when the SP omits it", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 201, ResponseMess: "Team created successfully", TeamId: 8 }]],
    });
    const req = baseReq({ body: { Name: "Ops" } });
    const res = mockRes();

    await teamController.save(req, res);

    expect(res.json.mock.calls[0][0].data).toEqual({ teamId: 8, memberCount: 0 });
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Team Ops created (0 members)" }),
    );
  });

  /**
   * FIXED 2026-08-04 (controller + 070_team_roster_guard.sql).
   *
   * sp_SaveTeam replaces the whole roster and cascades that into every linked
   * project workspace, so "said nothing about members" and "wants no members"
   * cannot share a value. They used to: Members defaulted to `[]` and both an
   * empty array and a missing key became null, which the SP read as "no
   * opinion" — while still running an unconditional DELETE first. Renaming a
   * team therefore deleted every member and soft-removed them from its project
   * workspaces. The web form escaped it only by posting the whole array back
   * every time.
   *
   * Three states now: absent -> null (leave alone), [] -> '[]' (clear),
   * [1,2] -> '[1,2]' (replace).
   */
  it("omits Members entirely for a name-only update, so the roster survives", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ ResponseCode: 200, ResponseMess: "Team updated successfully", TeamId: 8, MemberCount: 2 }],
      ],
    });
    const req = baseReq({ body: { Id: 8, Name: "Ops renamed" } });
    const res = mockRes();

    await teamController.save(req, res);

    expect(database.executeStoredProcedure.mock.calls[0][1].Members).toBeNull();
  });

  it("sends '[]' for an explicit empty array, so clearing a roster still works", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ ResponseCode: 200, ResponseMess: "Team updated successfully", TeamId: 8, MemberCount: 0 }],
      ],
    });
    const req = baseReq({ body: { Id: 8, Name: "Ops", Members: [] } });
    const res = mockRes();

    await teamController.save(req, res);

    // The distinction the whole fix rests on: '[]' is not null.
    expect(database.executeStoredProcedure.mock.calls[0][1].Members).toBe("[]");
  });

  /**
   * A non-array payload (an already-stringified array, an object, junk) is
   * treated as ABSENT rather than as a clear. Refusing to touch the roster is
   * the safe reading of an input we do not understand — the alternative is
   * deleting everyone because a client sent the wrong shape.
   *
   * Note the sibling disagreement this leaves in place: projectController.save
   * passes a Members string straight through to its SP.
   */
  it("treats a non-array Members payload as absent, not as a clear", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(created);
    const req = baseReq({ body: { Name: "Ops", Members: "[11,12]" } });
    const res = mockRes();

    await teamController.save(req, res);

    expect(database.executeStoredProcedure.mock.calls[0][1].Members).toBeNull();
  });

  // BUG: the create/update decision is `Id === 0`, a strict compare against a
  // number. A client sending the string "0" is a create as far as SQL Server
  // is concerned — @Id INT coerces it — but the audit trail records
  // "Updated" for a row that was just inserted. Should be `Number(Id) === 0`.
  it("mislabels a create as an update when Id arrives as the string '0'", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(created);
    const req = baseReq({ body: { Id: "0", Name: "Ops" } });
    const res = mockRes();

    await teamController.save(req, res);

    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "Updated", description: "Team Ops updated (2 members)" }),
    );
  });

  // BUG: save never consults req.scope, and sp_SaveTeam's update path gates on
  // CompId alone. Any authenticated user in the company can therefore rename,
  // deactivate, or re-lead ANY team in any branch by posting its Id — the
  // branch fence that guards fetch and delete is absent from the write path.
  // (Matches the "write path does not check ownership" known-open in ROLES.md.)
  it("sends no scope parameters at all, so the write path is unfenced", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [{ ResponseCode: 200, ResponseMess: "Team updated successfully", TeamId: 99, MemberCount: 0 }],
      ],
    });
    const req = baseReq({
      scope: { branchIds: [2], ownerIds: [7] },
      body: { Id: 99, Name: "Another branch's team" },
    });
    const res = mockRes();

    await teamController.save(req, res);

    const params = database.executeStoredProcedure.mock.calls[0][1];
    expect(params).not.toHaveProperty("AccessibleBranchIdsJson");
    expect(params).not.toHaveProperty("UserId");
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // The SP rejects a blank Name, so this only bites if that guard is ever
  // relaxed — pinned because the fallback produces a description with a hole
  // in it ("Team  created") rather than anything a reader can act on.
  it("falls back to an empty name in the activity description", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(created);
    const req = baseReq({ body: { Members: [11, 12] } });
    const res = mockRes();

    await teamController.save(req, res);

    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Team  created (2 members)" }),
    );
  });

  it("surfaces the SP's own code and message on a non-2xx, and logs nothing", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 400, ResponseMess: "Team name is required" }]],
    });
    const req = baseReq({ body: { Description: "no name" } });
    const res = mockRes();

    await teamController.save(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      message: "Team name is required",
      responseCode: 400,
      data: null,
    });
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("does not log when the SP succeeds but returns no TeamId", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "Nothing to do" }]],
    });
    const req = baseReq({ body: { Id: 8, Name: "Ops" } });
    const res = mockRes();

    await teamController.save(req, res);

    expect(logActivity).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data).toEqual({
      teamId: undefined,
      memberCount: 0,
    });
  });

  it("500s with TEAM_SAVE_ERROR when the database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({ body: { Name: "Ops" } });
    const res = mockRes();

    await teamController.save(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      message: "Failed to save team",
      code: "TEAM_SAVE_ERROR",
      responseCode: 500,
    });
    expect(logActivity).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------
describe("teamController.fetch", () => {
  const envelope = {
    ResponseCode: 200,
    ResponseMess: "Teams retrieved successfully",
    TotalRecords: 1,
    TotalPages: 1,
    CurrentPage: 1,
    PageSize: 10,
  };
  const oneTeam = {
    recordsets: [
      [
        {
          ...envelope,
          Id: 8,
          Name: "Ops",
          BranchId: 2,
          Members: '[{"UserId":11,"FullName":"Ada"}]',
        },
      ],
    ],
  };

  it("calls sp_FetchTeam with the full param set and parses the Members JSON", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(oneTeam);
    const req = baseReq({ body: {} });
    const res = mockRes();

    await teamController.fetch(req, res);

    // No UserId — sp_FetchTeam's signature genuinely has none (verified
    // against sys.sql_modules), unlike sp_FetchProject. The consequence is
    // that a team cannot be made visible to a member outside the branch
    // scope the way a project can.
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_FetchTeam", {
      Id: 0,
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
    expect(body.data.teams).toEqual([
      { Id: 8, Name: "Ops", BranchId: 2, Members: [{ UserId: 11, FullName: "Ada" }] },
    ]);
    expect(body.data.pagination).toEqual({
      currentPage: 1,
      pageSize: 10,
      totalRecords: 1,
      totalPages: 1,
    });
  });

  it("passes body paging and search through", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(oneTeam);
    const req = baseReq({
      body: { Id: 8, PageNumber: 2, PageSize: 50, SearchTerm: "ops" },
    });
    const res = mockRes();

    await teamController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchTeam",
      expect.objectContaining({
        Id: 8,
        PageNumber: 2,
        PageSize: 50,
        SearchTerm: "ops",
      }),
    );
  });

  /**
   * SECURITY, do not relax. An empty branch scope must serialise as the string
   * "[]" and never as null. sp_FetchTeam reads NULL as "@UseScope = 0", which
   * falls back to `@IsAdmin = 1 OR BranchId = @BranchId` — no allow-list at
   * all. "[]" is an empty allow-list and matches nothing.
   */
  it("serialises an empty scope as '[]', never null", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(oneTeam);
    const req = baseReq({ scope: { branchIds: [], ownerIds: [] } });
    const res = mockRes();

    await teamController.fetch(req, res);

    const params = database.executeStoredProcedure.mock.calls[0][1];
    expect(params.AccessibleBranchIdsJson).toBe("[]");
    expect(params.AccessibleBranchIdsJson).not.toBeNull();
  });

  it("falls back to null only when req.scope is absent entirely", async () => {
    // loadScope always runs on this route, so in production this is
    // unreachable; pinned because it is the one path that disables the branch
    // allow-list, and a refactor must not widen it to reachable code.
    database.executeStoredProcedure.mockResolvedValueOnce(oneTeam);
    const req = baseReq({ scope: undefined });
    const res = mockRes();

    await teamController.fetch(req, res);

    expect(
      database.executeStoredProcedure.mock.calls[0][1].AccessibleBranchIdsJson,
    ).toBeNull();
  });

  it("takes CompId from req.user and ignores the body's", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(oneTeam);
    const req = baseReq({ body: { CompId: 999, BranchId: 888, IsAdmin: true } });
    const res = mockRes();

    await teamController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchTeam",
      expect.objectContaining({ CompId: 5, BranchId: 2, IsAdmin: false }),
    );
  });

  it("returns Members as [] when the column is null", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ...envelope, Id: 8, Name: "Ops", Members: null }]],
    });
    const req = baseReq();
    const res = mockRes();

    await teamController.fetch(req, res);

    expect(res.json.mock.calls[0][0].data.teams).toEqual([
      { Id: 8, Name: "Ops", Members: [] },
    ]);
  });

  // sp_FetchTeam hand-builds its Members JSON with STRING_AGG and escapes
  // quotes as \\" — a backslash-escape SQL Server writes but JSON.parse
  // rejects. A member whose FullName contains a double quote therefore lands
  // here. The controller swallows it and returns an empty roster rather than
  // failing the request.
  it("swallows malformed Members JSON and returns an empty roster", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ...envelope, Id: 8, Name: "Ops", Members: "[{not json" }]],
    });
    const req = baseReq();
    const res = mockRes();

    await teamController.fetch(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.teams).toEqual([
      { Id: 8, Name: "Ops", Members: [] },
    ]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("drops the SP's all-NULL placeholder row from an empty result", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [
          {
            ResponseCode: 200,
            ResponseMess: "No teams found",
            TotalRecords: 0,
            TotalPages: 0,
            CurrentPage: 1,
            PageSize: 10,
            Id: null,
            Name: null,
            Members: null,
          },
        ],
      ],
    });
    const req = baseReq();
    const res = mockRes();

    await teamController.fetch(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.data.teams).toEqual([]);
    expect(body.data.pagination.totalRecords).toBe(0);
    expect(body.success).toBe(true);
  });

  it("surfaces a non-200 with the SP's own code and message", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 404, ResponseMess: "Team not found", Id: null, Members: null }]],
    });
    const req = baseReq({ body: { Id: 999 } });
    const res = mockRes();

    await teamController.fetch(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      message: "Team not found",
      responseCode: 404,
    });
  });

  it("500s with TEAM_FETCH_ERROR when the database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq();
    const res = mockRes();

    await teamController.fetch(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      message: "Failed to fetch teams",
      code: "TEAM_FETCH_ERROR",
      responseCode: 500,
    });
  });

  /**
   * WAS A BUG, fixed 2026-08-04 by adopting controllerKit's firstRow/spStatus.
   *
   * An SP that returns an empty first recordset (no rows at all, e.g. a RETURN
   * before any SELECT) made `result.recordsets[0][0]` undefined, and reading
   * .ResponseCode off it threw — the caller got an opaque 500 from the catch
   * block with a stack trace behind it. It is still a 500, because a status row
   * that does not exist is a malformed response and guessing 200 is how a
   * failure gets reported as an empty list — but it is now a well-formed
   * envelope rather than a TypeError, so `code` is no longer set.
   */
  it("turns an empty recordset into a clean 500, not a thrown TypeError", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
    const req = baseReq();
    const res = mockRes();

    await teamController.fetch(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({ success: false, responseCode: 500 });
    expect(body.data.teams).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------
describe("teamController.delete", () => {
  it("calls sp_DeleteTeam with the full param set and logs the delete", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "Team deleted successfully" }]],
    });
    const req = baseReq({ body: { Id: 8 } });
    const res = mockRes();

    await teamController.delete(req, res);

    // No UserId: sp_DeleteTeam's signature has none, so the only fence is
    // CompId + (IsAdmin OR BranchId).
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_DeleteTeam", {
      Id: 8,
      CompId: 5,
      BranchId: 2,
      IsAdmin: false,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: true,
      message: "Team deleted successfully",
      responseCode: 200,
    });
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "Team",
        entityId: 8,
        action: "Deleted",
        description: "Team deleted",
        req,
      }),
    );
  });

  it("takes CompId from req.user and ignores the body's", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 200, ResponseMess: "Team deleted successfully" }]],
    });
    const req = baseReq({ body: { Id: 8, CompId: 999, BranchId: 888, IsAdmin: true } });
    const res = mockRes();

    await teamController.delete(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_DeleteTeam",
      expect.objectContaining({ CompId: 5, BranchId: 2, IsAdmin: false }),
    );
  });

  it.each([
    ["missing", {}],
    ["zero", { Id: 0 }],
    ["negative", { Id: -1 }],
  ])("400s on a %s Id, before touching the database", async (_label, body) => {
    const req = baseReq({ body });
    const res = mockRes();

    await teamController.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      message: "Team ID is required",
      code: "VALIDATION_ERROR",
      responseCode: 400,
    });
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("surfaces the SP's 409 and logs nothing when the team is still in use", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [
        [
          {
            ResponseCode: 409,
            ResponseMess:
              "Cannot delete team - assigned to projects. Please reassign projects first",
          },
        ],
      ],
    });
    const req = baseReq({ body: { Id: 8 } });
    const res = mockRes();

    await teamController.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      responseCode: 409,
      message:
        "Cannot delete team - assigned to projects. Please reassign projects first",
    });
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("surfaces the SP's 404 for a team outside the caller's company or branch", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce({
      recordsets: [[{ ResponseCode: 404, ResponseMess: "Team not found or access denied" }]],
    });
    const req = baseReq({ body: { Id: 999 } });
    const res = mockRes();

    await teamController.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].success).toBe(false);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("500s with TEAM_DELETE_ERROR when the database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const req = baseReq({ body: { Id: 8 } });
    const res = mockRes();

    await teamController.delete(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      message: "Failed to delete team",
      code: "TEAM_DELETE_ERROR",
      responseCode: 500,
    });
    expect(logActivity).not.toHaveBeenCalled();
  });
});
