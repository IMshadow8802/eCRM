jest.mock("../../../src/config/database", () => ({
  executeStoredProcedure: jest.fn(),
}));
jest.mock("../../../src/utils/activityLogger", () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  ACTIONS: {
    CREATED: "Created",
    UPDATED: "Updated",
    DELETED: "Deleted",
    ASSIGNED: "Assigned",
    TRANSFERRED: "Transferred",
  },
}));

const database = require("../../../src/config/database");
const { logActivity } = require("../../../src/utils/activityLogger");
const workspaceController = require("../../../src/controllers/workspaceController");
const { mockRes } = require("../../helpers/mockRes");

function baseReq(overrides = {}) {
  return {
    user: { UserId: 7, CompId: 1, BranchId: 2, IsAdmin: false },
    scope: { branchIds: [1, 2, 3] },
    body: {},
    ip: "10.0.0.1",
    headers: { "user-agent": "jest" },
    ...overrides,
  };
}

function spResult(rows) {
  return { recordsets: [rows] };
}

beforeEach(() => {
  database.executeStoredProcedure.mockReset();
  logActivity.mockClear();
});

describe("workspaceController.save", () => {
  it("creates a shared workspace with invited members, seeds template, logs activity", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "Workspace created", WorkspaceId: 42 }]),
    );
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "Template applied", WorkspaceId: 42, TemplateKey: "basic", ColumnsCreated: 3 }]),
    );

    const req = baseReq({
      body: {
        Name: "Marketing",
        Type: "shared",
        Color: "#F59E0B",
        TemplateKey: "basic",
        Members: [3, 4, 9],
      },
    });
    const res = mockRes();
    await workspaceController.save(req, res);

    const calls = database.executeStoredProcedure.mock.calls;
    expect(calls[0][0]).toBe("sp_SaveWorkspace");
    expect(calls[0][1]).toEqual(
      expect.objectContaining({
        Id: 0,
        Name: "Marketing",
        Type: "shared",
        OwnerUserId: 7,
        CompId: 1,
        BranchId: 2,
        Color: "#F59E0B",
        MembersJson: JSON.stringify([3, 4, 9]),
      }),
    );
    expect(calls[1][0]).toBe("sp_ApplyKanbanTemplate");
    expect(calls[1][1]).toEqual({
      WorkspaceId: 42,
      TemplateKey: "basic",
      CompId: 1,
      BranchId: 2,
    });
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "Workspace",
        entityId: 42,
        action: "Created",
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    const json = res.json.mock.calls[0][0];
    expect(json.success).toBe(true);
    expect(json.data).toEqual({ workspaceId: 42, columnsSeeded: 3 });
  });

  it("creates a project workspace with the requested TemplateKey", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "Workspace created", WorkspaceId: 7 }]),
    );
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "Template applied", WorkspaceId: 7, TemplateKey: "scrum", ColumnsCreated: 5 }]),
    );

    const req = baseReq({
      body: { Name: "Sprint", Type: "project", ProjectId: 9, TemplateKey: "scrum" },
    });
    const res = mockRes();
    await workspaceController.save(req, res);

    const calls = database.executeStoredProcedure.mock.calls;
    expect(calls[1][1].TemplateKey).toBe("scrum");
    expect(res.json.mock.calls[0][0].data.columnsSeeded).toBe(5);
  });

  it("does NOT call sp_ApplyKanbanTemplate when creating a personal workspace", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "Workspace created", WorkspaceId: 1 }]),
    );

    const req = baseReq({ body: { Name: "My Tasks", Type: "personal" } });
    const res = mockRes();
    await workspaceController.save(req, res);

    const spNames = database.executeStoredProcedure.mock.calls.map((c) => c[0]);
    expect(spNames).toEqual(["sp_SaveWorkspace"]);
  });

  it("still succeeds + logs when template SP throws (save is source of truth)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "Workspace created", WorkspaceId: 99 }]),
    );
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("template boom"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});

    const req = baseReq({ body: { Name: "X", Type: "shared" } });
    const res = mockRes();
    await workspaceController.save(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data.columnsSeeded).toBe(0);
    expect(logActivity).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("updates a workspace and logs UPDATED when Id > 0 (no template reseed)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Workspace updated", WorkspaceId: 5 }]),
    );

    const req = baseReq({ body: { Id: 5, Name: "Renamed", Type: "shared" } });
    const res = mockRes();
    await workspaceController.save(req, res);

    const spNames = database.executeStoredProcedure.mock.calls.map((c) => c[0]);
    expect(spNames).toEqual(["sp_SaveWorkspace"]);
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "Updated", entityId: 5 }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("does not log activity when SP returns validation error", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 400, ResponseMess: "Workspace name is required" }]),
    );

    const req = baseReq({ body: { Name: "", Type: "shared" } });
    const res = mockRes();
    await workspaceController.save(req, res);

    expect(logActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    const json = res.json.mock.calls[0][0];
    expect(json.success).toBe(false);
    expect(json.data).toBeNull();
  });

  it("omits MembersJson when no members array is provided", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "ok", WorkspaceId: 1 }]),
    );
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "ok", ColumnsCreated: 3 }]),
    );

    const req = baseReq({ body: { Name: "Solo", Type: "shared" } });
    const res = mockRes();
    await workspaceController.save(req, res);

    expect(database.executeStoredProcedure.mock.calls[0][1].MembersJson).toBeNull();
  });

  it("returns 500 when database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const req = baseReq({ body: { Name: "X", Type: "shared" } });
    const res = mockRes();

    await workspaceController.save(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const json = res.json.mock.calls[0][0];
    expect(json.success).toBe(false);
    expect(json.code).toBe("WORKSPACE_SAVE_ERROR");
    spy.mockRestore();
  });
});

describe("workspaceController.fetch", () => {
  it("returns cleaned workspace rows + pagination envelope", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "Workspaces retrieved",
          TotalRecords: 2,
          TotalPages: 1,
          CurrentPage: 1,
          PageSize: 25,
          Id: 1,
          Name: "My Tasks",
          Type: "personal",
          OwnerUserId: 7,
          MemberCount: 1,
          MyRole: "owner",
        },
        {
          ResponseCode: 200,
          ResponseMess: "Workspaces retrieved",
          TotalRecords: 2,
          TotalPages: 1,
          CurrentPage: 1,
          PageSize: 25,
          Id: 2,
          Name: "Team",
          Type: "shared",
          OwnerUserId: 7,
          MemberCount: 3,
          MyRole: "owner",
        },
      ]),
    );

    const req = baseReq({ body: { PageNumber: 1, PageSize: 25 } });
    const res = mockRes();
    await workspaceController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchWorkspaces",
      expect.objectContaining({
        UserId: 7,
        CompId: 1,
        BranchId: 2,
        IsAdmin: false,
        AccessibleBranchIdsJson: JSON.stringify([1, 2, 3]),
        PageNumber: 1,
        PageSize: 25,
      }),
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const json = res.json.mock.calls[0][0];
    expect(json.data.workspaces).toHaveLength(2);
    expect(json.data.workspaces[0]).toMatchObject({ Id: 1, Type: "personal" });
    expect(json.data.pagination).toEqual({
      currentPage: 1,
      pageSize: 25,
      totalRecords: 2,
      totalPages: 1,
    });
  });

  it("passes null AccessibleBranchIdsJson when scope is empty", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "No workspaces found",
          TotalRecords: 0,
          TotalPages: 0,
          CurrentPage: 1,
          PageSize: 25,
          Id: null,
        },
      ]),
    );

    const req = baseReq({ scope: {} });
    const res = mockRes();
    await workspaceController.fetch(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_FetchWorkspaces",
      expect.objectContaining({ AccessibleBranchIdsJson: null }),
    );
    const json = res.json.mock.calls[0][0];
    expect(json.data.workspaces).toHaveLength(0);
  });

  it("returns 500 when database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("db down"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const req = baseReq();
    const res = mockRes();

    await workspaceController.fetch(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("WORKSPACE_FETCH_ERROR");
    spy.mockRestore();
  });
});

describe("workspaceController.addMember", () => {
  it("rejects missing WorkspaceId or UserId with 400", async () => {
    const req = baseReq({ body: { Role: "member" } });
    const res = mockRes();
    await workspaceController.addMember(req, res);

    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe("VALIDATION_ERROR");
  });

  it("calls sp_AddWorkspaceMember and logs on success", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 201,
          ResponseMess: "Member added",
          WorkspaceId: 4,
          UserId: 9,
          Role: "member",
        },
      ]),
    );

    const req = baseReq({ body: { WorkspaceId: 4, UserId: 9 } });
    const res = mockRes();
    await workspaceController.addMember(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_AddWorkspaceMember",
      expect.objectContaining({
        WorkspaceId: 4,
        UserId: 9,
        Role: "member",
        ActingUserId: 7,
        IsAdmin: false,
        CompId: 1,
      }),
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "Workspace", entityId: 4 }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("does not log on 403", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 403, ResponseMess: "Only owner can add" }]),
    );
    const req = baseReq({ body: { WorkspaceId: 4, UserId: 9 } });
    const res = mockRes();
    await workspaceController.addMember(req, res);
    expect(logActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 500 when database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("oops"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const req = baseReq({ body: { WorkspaceId: 4, UserId: 9 } });
    const res = mockRes();
    await workspaceController.addMember(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("WORKSPACE_MEMBER_ADD_ERROR");
    spy.mockRestore();
  });
});

describe("workspaceController.removeMember", () => {
  it("rejects missing ids with 400", async () => {
    const req = baseReq({ body: { WorkspaceId: 4 } });
    const res = mockRes();
    await workspaceController.removeMember(req, res);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("calls sp_RemoveWorkspaceMember and logs on 200", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Member removed" }]),
    );
    const req = baseReq({ body: { WorkspaceId: 4, UserId: 9 } });
    const res = mockRes();
    await workspaceController.removeMember(req, res);

    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "Transferred", entityId: 4 }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("does not log when SP returns 404", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 404, ResponseMess: "Member not found" }]),
    );
    const req = baseReq({ body: { WorkspaceId: 4, UserId: 9 } });
    const res = mockRes();
    await workspaceController.removeMember(req, res);
    expect(logActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 500 when database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("fail"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const req = baseReq({ body: { WorkspaceId: 4, UserId: 9 } });
    const res = mockRes();
    await workspaceController.removeMember(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("WORKSPACE_MEMBER_REMOVE_ERROR");
    spy.mockRestore();
  });
});

describe("workspaceController.applyTemplate", () => {
  it("rejects missing WorkspaceId", async () => {
    const res = mockRes();
    await workspaceController.applyTemplate(baseReq({ body: {} }), res);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("calls sp on success with default TemplateKey", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 201,
          ResponseMess: "Template applied",
          WorkspaceId: 3,
          TemplateKey: "basic",
          ColumnsCreated: 3,
        },
      ]),
    );
    const res = mockRes();
    await workspaceController.applyTemplate(
      baseReq({ body: { WorkspaceId: 3 } }),
      res,
    );
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_ApplyKanbanTemplate",
      expect.objectContaining({ WorkspaceId: 3, TemplateKey: "basic", CompId: 1 }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data.columnsCreated).toBe(3);
  });

  it("returns 500 when DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await workspaceController.applyTemplate(
      baseReq({ body: { WorkspaceId: 3 } }),
      mockRes(),
    );
    spy.mockRestore();
  });
});

describe("workspaceController.ensurePersonal", () => {
  it("seeds workspace on first call and logs Created", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 201,
          ResponseMess: "Personal workspace seeded",
          WorkspaceId: 99,
          Seeded: 1,
        },
      ]),
    );
    const req = baseReq();
    const res = mockRes();
    await workspaceController.ensurePersonal(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SeedDefaultWorkspace",
      { UserId: 7, CompId: 1, BranchId: 2 },
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 99, action: "Created" }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data).toEqual({ workspaceId: 99, seeded: true });
  });

  it("does not log when already seeded (Seeded=0)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "Personal workspace already exists",
          WorkspaceId: 1,
          Seeded: 0,
        },
      ]),
    );
    const req = baseReq();
    const res = mockRes();
    await workspaceController.ensurePersonal(req, res);
    expect(logActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual({ workspaceId: 1, seeded: false });
  });

  it("returns 500 when DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await workspaceController.ensurePersonal(baseReq(), mockRes());
    spy.mockRestore();
  });
});

describe("workspaceController.archive", () => {
  it("rejects missing WorkspaceId with 400", async () => {
    const req = baseReq({ body: {} });
    const res = mockRes();
    await workspaceController.archive(req, res);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("archives (IsArchived=true) and logs DELETED", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Workspace archived" }]),
    );
    const req = baseReq({ body: { WorkspaceId: 11 } });
    const res = mockRes();
    await workspaceController.archive(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_ArchiveWorkspace",
      expect.objectContaining({ WorkspaceId: 11, IsArchived: 1 }),
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "Deleted", entityId: 11 }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("unarchives (IsArchived=false) and logs UPDATED", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Workspace unarchived" }]),
    );
    const req = baseReq({ body: { WorkspaceId: 11, IsArchived: false } });
    const res = mockRes();
    await workspaceController.archive(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_ArchiveWorkspace",
      expect.objectContaining({ IsArchived: 0 }),
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "Updated" }),
    );
  });

  it("does not log when SP returns 403", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 403, ResponseMess: "denied" }]),
    );
    const req = baseReq({ body: { WorkspaceId: 11 } });
    const res = mockRes();
    await workspaceController.archive(req, res);
    expect(logActivity).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 500 when database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const req = baseReq({ body: { WorkspaceId: 11 } });
    const res = mockRes();
    await workspaceController.archive(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("WORKSPACE_ARCHIVE_ERROR");
    spy.mockRestore();
  });
});

describe("workspaceController.respondInvite", () => {
  it("accepts invite + logs activity", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "Invite accepted",
          WorkspaceId: 21,
          InviteStatus: "active",
        },
      ]),
    );

    const req = baseReq({ body: { WorkspaceId: 21, Action: "accept" } });
    const res = mockRes();
    await workspaceController.respondInvite(req, res);

    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_RespondWorkspaceInvite",
      { WorkspaceId: 21, UserId: 7, Action: "accept", CompId: 1 },
    );
    expect(logActivity).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual({
      workspaceId: 21,
      inviteStatus: "active",
    });
  });

  it("declines invite", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([
        {
          ResponseCode: 200,
          ResponseMess: "Invite declined",
          WorkspaceId: 9,
          InviteStatus: "declined",
        },
      ]),
    );

    const req = baseReq({ body: { WorkspaceId: 9, Action: "decline" } });
    const res = mockRes();
    await workspaceController.respondInvite(req, res);

    expect(database.executeStoredProcedure.mock.calls[0][1].Action).toBe(
      "decline",
    );
    expect(res.json.mock.calls[0][0].data.inviteStatus).toBe("declined");
  });

  it("400 on bad action", async () => {
    const req = baseReq({ body: { WorkspaceId: 1, Action: "whatever" } });
    const res = mockRes();
    await workspaceController.respondInvite(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("400 when fields missing", async () => {
    const req = baseReq({ body: {} });
    const res = mockRes();
    await workspaceController.respondInvite(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 500 when database throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("boom"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const req = baseReq({ body: { WorkspaceId: 1, Action: "accept" } });
    const res = mockRes();
    await workspaceController.respondInvite(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].code).toBe("WORKSPACE_INVITE_ERROR");
    spy.mockRestore();
  });
});
